import axios from 'axios'
import config from '../config';
import { createVerify, createSign, createHash } from 'crypto';
import { firestore } from '../preload';
import * as Joi from 'joi'
import { URL } from 'url';

// Magics
const IsLocal = Symbol('IsLocal')

const ActorActivity = () => firestore.collection('ActorActivity')
const Accounts = () => firestore.collection('accounts')

type ActorActivity = {
  id: string,
  preferredUsername: string,
  publicKey: {
    publicKeyPem: string
  },
  inbox: string
}

type Keyring = {
  pub: string,
  key?: string
}

class Actor {
  private _isLocal: boolean
  private _freshRemoteActorActivity: boolean
  private _id?: string
  private _userpart: string
  private _keyring: Keyring
  private _activity?: ActorActivity
  private _inboxURI: string

  // local's one
  static async findById (id: string) {
    const doc = await Accounts().doc(id).get()
    if (!doc.exists) throw new Error('No specific accout!')
    const d = doc.data()

    return new Actor({
      id: doc.id,
      userpart: d.userpart,
      keyring: d.keyring,
      [IsLocal]: true,
      // remove InboxURI
      inboxURI: 'dummmy',
    })
  }

  static async findByUserpart(userpart: string) {
    const uSnapshot = await Accounts().where('userpart', '==', userpart).limit(1).get()
    if (uSnapshot.size === 0) throw new Error('No specific accout!')
    const u = uSnapshot.docs[0]
    const d = u.data()

    return new Actor({
      id: u.id,
      userpart: d.userpart,
      keyring: d.keyring,
      [IsLocal]: true,
      // remove InboxURI
      inboxURI: 'dummmy',
    })
  }

  // remote's one
  static async fetch(uri: string) {
    // TODO: Joi の validator を移動する
    // もっとちゃんと validator 書く
    // 別のライブラリ使う (validate の)
    const [raw, fresh = false] = await (async () => {
      const url = new URL(uri)
      url.hash = null

      // cache
      const h = createHash('sha256')
      h.update(url.href)
      const doc = await ActorActivity().doc(h.digest('hex')).get()
      if (doc.exists) {
        // enabled at only 1 day
        const d = doc.createTime.toDate()
        d.setDate(d.getDate() + 1)
        if (d > (new Date())) return [doc.data()]
      }

      return [await axios.get(uri, {
        headers: {
          'Accept': 'application/activity+json'
        }
      }).then(v => v.data), true]
    })()
    const { error, value } = Joi.object().required().keys({
      id: Joi.string().required(),
      preferredUsername: Joi.string().required(),
      inbox: Joi.string().required(),
      publicKey: Joi.object().required().keys({
        id: Joi.string().required(),
        owner: Joi.string().required(),
        publicKeyPem: Joi.string().required()
      })
    }).unknown(true).validate<ActorActivity>(raw)
    if (error) throw error
    return new Actor({
      keyring: {
        pub: value.publicKey.publicKeyPem
      },
      userpart: value.preferredUsername,
      activity: value,
      fresh,
      inboxURI: value.inbox
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
    id = null,
    [IsLocal]: isLocal = null,
    keyring,
    userpart,
    activity = null,
    fresh = false,
    inboxURI
  }: {
      id?: string,
      [IsLocal]?: any,
      keyring: Keyring,
      userpart: string,
      activity?: ActorActivity,
      fresh?: boolean,
      inboxURI: string
    }) {
    this._isLocal = isLocal !== null
    if (!this._isLocal && (!activity)) {
      throw new Error('No activity')
    } else {
      this._activity = activity
    }
    if (this._isLocal && !id) throw new Error ('no id')
    this._id = id
    this._keyring = keyring
    this._userpart = userpart
    this._freshRemoteActorActivity = fresh
    this._inboxURI = inboxURI
    return
  }

  get id() {
    return this._id
  }

  get inboxURI () {
    return this._inboxURI
  }

  get isLocal() {
    return this._isLocal
  }

  // FIXME: なんか JSON ってネーミング気に入らん
  toJSON() {
    if (!this._isLocal) throw new Error('Can not convert non local')
    return {
      "@context": [
        "https://www.w3.org/ns/activitystreams"
      ],
      "id": `https://${config.service.host}/ap/accounts/@${this._userpart}`,
      "type": "Person",
      "inbox": `https://${config.service.host}/ap/accounts/@${this._userpart}/inbox`,
      preferredUsername: this._userpart,
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
    if (!this._freshRemoteActorActivity) return
    const h = createHash('sha256')
    h.update(this._activity.id)
    await ActorActivity().doc(h.digest('hex')).set(this._activity)
  }

  async send (target: Actor, activity: any) {
    if (!this._isLocal) throw new Error('Can not convert non local')
    if (target.isLocal) return

    const inboxUrl = new URL(target.inboxURI)

    const headers = {
      date: (new Date()).toUTCString(),
      host: inboxUrl.host
    } as any
    const sign: string = ((requestTarget: string) => {
      const source = [
        `(request-target): ${requestTarget}`
      ]
      Object.keys(headers).forEach(key => {
        source.push(`${key.toLowerCase()}: ${headers[key]}`)
      })
      
      const s = source.join('\n')

      return this.sign(s)
    })(`post ${inboxUrl.pathname}`)
    headers.signature = `keyId="https://${config.service.host}/ap/accounts/@${this._userpart}#key",headers="(request-target) ${Object.keys(headers).map(v => v.toLowerCase()).join(' ')}",signature="${sign}"`

    await axios.post(target.inboxURI, activity, {headers})
  }

  async followers () {
    if (!this._isLocal) throw new Error('Can not convert non local')
    const snapshot = await Accounts().doc(this.id).collection('followers').get()
    const fw = []
    snapshot.forEach(v => {
      fw.push(Actor.fetch(v.data().id))
    })
    return Promise.all(fw)
  }
}

export default Actor
