import axios from 'axios'
import Joi = require('joi')

export type ActorActivity = {
  id: string,
  preferredUsername: string,
  publicKey: {
    publicKeyPem: string
  },
  inbox: string
}

export default async (uri: string): Promise<ActorActivity> => {
  const raw = await axios.get(uri, {
    headers: {
      'Accept': 'application/activity+json'
    }
  }).then(v => v.data)

  // もっとちゃんと validator 書く
  // 別のライブラリ使う (validate の)
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

  return value
}
