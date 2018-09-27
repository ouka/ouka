import * as Functions from "firebase-functions";
import * as Joi from 'joi'
import Actor from "../models/actor";
import { inspect } from "util";

/**
 * TODO: Add error reporting!
 */

export const outbox = Functions.firestore.document('accounts/{id}/outbox/{param}').onCreate(async (doc, ctx) => {
  const { error, value: activity } = Joi.object().required().keys({
    type: Joi.any().required().allow('Follow', 'Accept', 'Create')
  }).validate(doc.data())

  const actor = await Actor.findById(ctx.params.id)

  let target: Actor[] = null
  switch (activity.type) {
    case 'Follow': {
      target = [await Actor.fetch(activity.object)]
      break
    }
    case 'Accept': {
      target = [await Actor.fetch(activity.object.actor)]
      break
    }
  }

  if (target === null) {
    target = await actor.followers()
  }


  return Promise.all(target.map(v => actor.send(v, activity)))
})
