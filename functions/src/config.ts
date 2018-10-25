import * as Functions from 'firebase-functions'
import Joi = require('joi');

const schema = Joi.object().required().keys({
  service: Joi.object().required().keys({
    host: Joi.string().required(),
    owner: Joi.object().required().keys({
      email: Joi.string().required()
    })
  })
})
const vr = schema.validate<{
  service: {
    host: string,
    owner: {
      email: string
    }
  }
}>(Functions.config() as any)
if (vr.error !== null) throw vr.error

const config = vr.value

export default config
