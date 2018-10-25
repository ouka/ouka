import * as Joi from 'joi'
import Actor from '~/models/actor'

export type Headers = {[k: string]: string}
export type Signature = {
  keyId: string,
  signature: string,
  headers?: string[],
  algorithm?: string
}

export class InvalidSignatureError extends Error {
  constructor (...args) {
    super(...args)
    this.name = 'InvalidSignatureError'
  }
}

export const decode = (signatureString: string) => {
  const signature = (() => {
    const v = signatureString.split(`",`).map(vv => vv.split(`="`))
    v[v.length-1][1] = v[v.length-1][1].split(`"`)[0] 
    return v.map((current): [string, string | string[]] => {
      const [key, rawValue] = current
      const value = key === 'headers' ? rawValue.split(' ') : rawValue
      return [key, value]
    }).reduce((target, current) => {
      target[current[0]] = current[1]
      return target
    }, {})
  })()

  const { error, value } = Joi.object().required().keys({
    keyId: Joi.string().required(),
    signature: Joi.string().required(),
    headers: Joi.array().items(Joi.string()),
    algorithm: Joi.string()
  }).validate<Signature>(signature as any)
  if (error) throw error

  return value
}

const DRAFT_CAVEGE_HTTP_SIGNATURES_10_REQUEST_TARGET = `(request-target)`
export const verify = async ({
  signature: inputSignature,
  headers,
  method,
  path,
  actor
}: {
  signature: Signature,
  headers: Headers,
  method: string,
  path: string,
  actor: Actor
}) => {
  const signature = inputSignature

  const sourceHeaders = signature.headers || ['Date']
  const source = sourceHeaders.map(k => {
    if (k === DRAFT_CAVEGE_HTTP_SIGNATURES_10_REQUEST_TARGET) return `${k}: ${method.toLowerCase()} ${path}`
    return `${k}: ${headers[k]}`
  }).join('\n')

  if (!actor.verify(source, signature.signature)) throw new InvalidSignatureError()

  return
}
