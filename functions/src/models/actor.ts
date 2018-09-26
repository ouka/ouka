import axios from 'axios'
import config from '../config';
import { createVerify, createSign } from 'crypto';
import { firestore } from '../preload';
import * as Joi from 'joi'

// Magics
const IsLocal = Symbol('IsLocal')

type Keyring = {
  pub: string,
  key?: string
}

class Actor {
  private _isLocal: boolean
  private _id: string
  private _userpart: string
  private _keyring: Keyring
  private _activity?: any

  // local's one
  static async findByUserpart(userpart: string) {
    const uSnapshot = await firestore.collection('accounts').where('userpart', '==', userpart).limit(1).get()
    if (uSnapshot.size === 0) throw new Error('No specific accout!')
    const u = uSnapshot.docs[0]
    const d = u.data()

    return new Actor({
      id: `https://${config.service.host}/accounts/${u.id}`,
      userpart: d.userpart,
      keyring: d.keyring,
      [IsLocal]: true
    })
  }

  // remote's one
  static async fetch(uri: string) {
    // TODO: Joi の validator を移動する
    const { error, value } = Joi.object().required().keys({
      id: Joi.string().required(),
      preferredUsername: Joi.string().required(),
      publicKey: Joi.object().required().keys({
        id: Joi.string().required(),
        owner: Joi.string().required(),
        publicKeyPem: Joi.string().required()
      })
    }).unknown(true).validate<{
      id: string,
      preferredUsername: string,
      publicKey: {
        publicKeyPem: string
      }
    }>(await axios.get(uri, {
      headers: {
        'Accept': 'application/activity+json'
      }
    }).then(v => v.data))
    if (error) throw error
    return new Actor({
      id: value.id,
      keyring: {
        pub: value.publicKey.publicKeyPem // string...
      },
      userpart: value.preferredUsername,
      activity: value
    })
  }

  // acct helper
  static async fetchByAcctURI(id: string) {
    const [userpart, host] = id.split('acct:')[1].split('@')

    // local user
    if (host === config.service.host) return Actor.findByUserpart(userpart)

    const wf = await axios.get(`https://${host}/.well-known/webfinger?resource=acct:${userpart}@${host}`)
    const link = wf.data.links.filter((v: any) => v.rel === 'self')[0]
    return Actor.fetch(link.href)
  }

  constructor({
    id,
    [IsLocal]: isLocal = null,
    keyring,
    userpart,
    activity = null
  }: {
      id: string,
      [IsLocal]?: any,
      keyring: Keyring,
      userpart: string,
      activity?: any
    }) {
    this._isLocal = isLocal !== null
    if (!this._isLocal && !activity) {
      throw new Error('No activity')
    } else {
      this._activity = activity
    }
    this._id = id
    this._keyring = keyring
    this._userpart = userpart
    return
  }

  get id () {
    return this._id
  }

  // FIXME: なんか JSON ってネーミング気に入らん
  toJSON() {
    if (!this._isLocal) throw new Error('Can not convert non local')
    return {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/v1"
      ],
      "id": `https://${config.service.host}/ap/accounts/@${this._userpart}`,
      "type": "Person",
      "inbox": `https://${config.service.host}/ap/accounts/@${this._userpart}/inbox`,
      "publicKey": {
        "id": `https://${config.service.host}/ap/accounts/@${this._userpart}#key`,
        "owner": `https://${config.service.host}/ap/accounts/@${this._userpart}`,
        "publicKeyPem": this._keyring.pub
      }
    }
  }

  sign(data: string) {
    if (!this._isLocal || !this._keyring.key) throw new Error('Can not call sign with remote actor.')
    const s = createSign('RSA-SHA256')
    s.update(data)
    return s.sign(this._keyring.key, 'base64')
  }

  verify(data: string, b64Signature: string) {
    const v = createVerify('RSA-SHA256')
    v.update(data) // utf-8
    return v.verify(this._keyring.pub, b64Signature, 'base64')
  }

  async save() {
    if (this._isLocal) return
    await firestore.collection('ActorActivity').doc().set(this._activity)
  }
}

export default Actor
