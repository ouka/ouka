import * as Functions from "firebase-functions"
import Joi = require('joi')
import Actor, { Activity } from "~/models/actor";
import * as types from '@ouka/activity-vocabulary/types'

const runtimeOpts = {
  timeoutSeconds: 30,
  memory: '128MB' as '128MB'
}

/**
 * TODO: Add error reporting!
 */

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

  actor.send(value)
})
