import config from '~/config';
import { createVerify, createSign, createHash } from 'crypto';
import { firestore } from '~/preload';
import Joi = require('joi')
import { URL } from 'url';
import axios from 'axios';

import fetchActorActivity, { ActorActivity } from '@ouka/fetch-actor-activity'
import * as types from '@ouka/activity-vocabulary/types'

const PUBLIC_ADDRESSING_ID = 'https://www.w3.org/ns/activitystreams#Public'

// Magics
export const IsLocal = Symbol('IsLocal')

const ActorActivityCollection = () => firestore.collection('ActorActivity')
const AccountsCollection = () => firestore.collection('accounts')

export type Keyring = {
  pub: string,
  key?: string
}

// FIXME: move this to lib/actibitypub OR lib/activity-vocabulary
export type Activity = {
  '@context': string | string[], // JSON-LD
  type: string,
  to: string | string[],
  bto?: string | string[],
  cc?: string | string[],
  bcc?: string | string[],
  audience?: string,
  object?: any // we can validate later
}

export default class Actor {
  private _isLocal: boolean
  private _id?: string
  private _userpart: string
  private _keyring: Keyring
  private _activity?: ActorActivity
  private _inboxURI: string | undefined
  private _publicInboxURI: string | undefined

  constructor({
    id = null,
    [IsLocal]: isLocal = null,
    keyring,
    userpart,
    activity = null,
    inboxURI,
    publicInboxURI
  }: {
      id?: string,
      [IsLocal]?: any,
      keyring: Keyring,
      userpart: string,
      activity?: ActorActivity,
      inboxURI?: string,
      publicInboxURI?: string
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
    this._publicInboxURI = publicInboxURI
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

  async send (value: Activity) {
    const receivers = [
      ...(Array.isArray(value.to) ? value.to : [value.to]),
      ...(Array.isArray(value.bto) ? value.bto : (typeof value.bto !== 'undefined' ? [value.bto] : [])),
      ...(Array.isArray(value.cc) ? value.cc : (typeof value.cc !== 'undefined' ? [value.cc] : [])),
      ...(Array.isArray(value.bcc) ? value.bcc : (typeof value.bcc !== 'undefined' ? [value.bcc] : [])),
    ]
 
    console.error(receivers.join(', '))

    // Public addressing
    const isPublicAddressing = receivers.includes(PUBLIC_ADDRESSING_ID)
  
    const activity = (() => {
      if (!types.Object.includes(value.type)) return {...value}
  
      const a = {
        '@context': ['https://www.w3.org/ns/activitystreams'],
        to: value.to,
        object: {
          ...value
        }
      } as Activity
      delete a.object['@context']
      if (typeof value.bto === 'undefined') a.bto = value.bto
      if (typeof value.cc === 'undefined') a.cc = value.cc
      if (typeof value.bcc === 'undefined') a.bcc = value.bto
  
      return a
    })()
    console.error(activity)
  
    // remove blind receivers
    delete activity.bto
    delete activity.bcc
    if ('object' in activity) {
      delete activity.object.bto
      delete activity.object.bcc
    }

    // Too Wip (not support collection...)
    const targetActors = (await Promise.all(receivers.map(async (v): Promise<null|Actor> => {
      console.dir(receivers)
      if (v == PUBLIC_ADDRESSING_ID) return Promise.resolve(null)
      return Actor.fetch(v)
    }))).filter(v => !!v)

    // URLs
    const targets = targetActors.map((actor: Actor) => {
      /**
      if (isPublicAddressing && false) {
        targets.push(actor.publicInboxURI)
      } else { */
        return actor.inboxURI
      //}
    })

    await Promise.all(targets.map(target => {
      this.sendTo(target, activity)
    }))
  }

  private async sendTo (target: string, activity) {
    console.log(target)

    if (!this._isLocal) throw new Error('Can not convert non local')

    const inboxUrl = new URL(target)

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

    return axios.post(target, activity, {headers})
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
