import * as Functions from "firebase-functions"
import Joi = require('joi')
import Actor from "~/models/actor";

import * as types from '@ouka/activity-vocabulary/types'

const runtimeOpts = {
  timeoutSeconds: 30,
  memory: '128MB' as '128MB'
}

/**
 * TODO: Add error reporting!
 */

// FIXME: move this to lib/actibitypub OR lib/activity-vocabulary
type Activity = {
  '@context': string | string[], // JSON-LD
  type: string,
  to: string | string[],
  bto?: string | string[],
  cc?: string | string[],
  bcc?: string | string[],
  audience?: string,
  object?: any // we can validate later
}

export const outbox = Functions.runWith(runtimeOpts).firestore.document('accounts/{id}/outbox/{param}').onCreate(async (doc, ctx) => {
  const actor = await Actor.findById(ctx.params.id)

  const validateTarget = Joi.alternatives().try(Joi.string(), Joi.array().items(Joi.string()))
  const { error, value } = Joi.object().required().keys({
    type: Joi.any().required().allow(...types.Activity, ...types.Object),
    to: validateTarget.required(),
    bto: validateTarget,
    cc: validateTarget,
    bcc: validateTarget,
    audience: validateTarget,
  }).unknown(true).validate<Activity>(doc.data() as any)
  if (error) throw error

  // 除外する || フラグにする: public collection
  const receivers = [
    ...(Array.isArray(value.to) ? value.to : [value.to]),
    ...(Array.isArray(value.bto) ? value.bto : (typeof value.bto === 'undefined' ? [value.bto] : [])),
    ...(Array.isArray(value.cc) ? value.cc : (typeof value.cc === 'undefined' ? [value.cc] : [])),
    ...(Array.isArray(value.bcc) ? value.bcc : (typeof value.bcc === 'undefined' ? [value.bcc] : [])),
  ]

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

  // remove blind receivers
  delete activity.bto
  delete activity.bcc
  if ('object' in activity) {
    delete activity.object.bto
    delete activity.object.bcc
  }

  // Too Wip (not support collection...)
  const targets = await Promise.all(receivers.map(v => Actor.fetch(v)))

  return Promise.all(targets.map(v => actor.send(v, activity)))
})
