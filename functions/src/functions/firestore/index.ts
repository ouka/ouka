import * as Functions from "firebase-functions"
import Joi = require('joi')
import Actor from "~/models/actor";

const runtimeOpts = {
  timeoutSeconds: 30,
  memory: '128MB' as '128MB'
}

/**
 * TODO: Add error reporting!
 */

export const outbox = Functions.runWith(runtimeOpts).firestore.document('accounts/{id}/outbox/{param}').onCreate(async (doc, ctx) => {
  const validateTarget = Joi.alternatives().try(Joi.string())

  const { error, value: activity } = Joi.object().required().keys({
    type: Joi.any().required().allow('Follow', 'Accept', 'Create', 'Note'),
    to: validateTarget.required(),
    bto: validateTarget,
    cc: validateTarget,
    bcc: validateTarget,
    audience: validateTarget,
  }).unknown(true).validate<{
    type: string,
    to: string,
    bto?: string,
    cc?: string,
    bcc?: string,
    audience?: string
  }>(doc.data() as any)
  if (error) throw error

  const actor = await Actor.findById(ctx.params.id)

  const targets = await Promise.all([
    activity.to,
    ...(activity.bto ? [activity.bto] : []),
    ...(activity.cc ? [activity.cc] : []),
    ...(activity.bcc ? [activity.bcc] : []),
    ...(activity.audience ? [activity.audience] : []),
  ].map(target => Actor.fetch(target)))

  return Promise.all(targets.map(v => actor.send(v, activity)))
})
