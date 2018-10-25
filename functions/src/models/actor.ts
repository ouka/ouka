import config from '~/config';
import { createVerify, createSign, createHash } from 'crypto';
import { firestore } from '~/preload';
import Joi = require('joi')
import { URL } from 'url';
import axios from 'axios';

import fetchActorActivity, { ActorActivity } from '@ouka/fetch-actor-activity'

// Magics
export const IsLocal = Symbol('IsLocal')

const ActorActivityCollection = () => firestore.collection('ActorActivity')
const AccountsCollection = () => firestore.collection('accounts')

export type Keyring = {
  pub: string,
  key?: string
}

export default class Actor {
  private _isLocal: boolean
  private _id?: string
  private _userpart: string
  private _keyring: Keyring
  private _activity?: ActorActivity
  private _inboxURI: string | undefined

  constructor({
    id = null,
    [IsLocal]: isLocal = null,
    keyring,
    userpart,
    activity = null,
    inboxURI
  }: {
      id?: string,
      [IsLocal]?: any,
      keyring: Keyring,
      userpart: string,
      activity?: ActorActivity,
      inboxURI?: string
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
    this._inboxURI = inboxURI
    return
  }

  // local's one
  static async findById (id: string) {
    const doc = await AccountsCollection().doc(id).get()
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
    const uSnapshot = await AccountsCollection().where('userpart', '==', userpart).limit(1).get()
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
    const activity = await (async () => {
      // cache key
      const url = new URL(uri)
      url.hash = null
      const h = createHash('sha256')
      h.update(url.href)
      const ref = ActorActivityCollection().doc(h.digest('hex'))

      // see cache
      const doc = await ref.get()
      if (doc.exists) {
        // enabled at only 1 day
        const d = doc.createTime.toDate()
        d.setDate(d.getDate() + 1)
        if (d > (new Date())) return doc.data() as ActorActivity
      }

      const activity = await fetchActorActivity(uri)
      await ref.set(activity)

      return activity
    })()

    return new Actor({
      keyring: {
        pub: activity.publicKey.publicKeyPem
      },
      userpart: activity.preferredUsername,
      activity: activity,
      inboxURI: activity.inbox
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
    const snapshot = await AccountsCollection().doc(this.id).collection('followers').get()
    const fw = []
    snapshot.forEach(v => {
      fw.push(Actor.fetch(v.data().id))
    })
    return Promise.all(fw)
  }
}
