import joi = require('joi')
import { Firestore } from '@google-cloud/firestore'

let store: Firestore
export const init = (firestore) => {
  if (!(firestore instanceof Firestore)) throw new Error('Not firestore instance.')
  store = firestore
  return
}

export class FieldDefinedTwiceError extends Error {
  constructor (...args) {
    super(...args)
    this.name = 'FieldDefinedTwiceError'
  }
}

export class FieldValidationError extends Error {
  errors: joi.ValidationError[] = []

  constructor (errors, ...args) {
    super(...args)
    this.name = 'FieldValidationError'
    this.errors = errors
  }
}

export class StoreNotPreparedError extends Error {
  constructor (...args) {
    super(...args)
    this.name = 'StoreNotPreparedError'
  }
}

function Require (target: Collection, key: string) {
  if (target[key]) throw new Error('Not defined!')
}

export class Collection {
  private _fields: {[K: string]: joi.AnySchema} = {}
  private _id: string = null

  get id () {
    return this._id
  }

  @Require
  collection: string

  defineField (k: string, v: joi.AnySchema) {
    if (k in this._fields) throw new FieldDefinedTwiceError(`Field '${k}' was defined already.`)
    this._fields[k] = v;
  }

  async create () {
    const o = this.toObject()
    const errors: joi.ValidationError[] = []
    Object.entries(this._fields).forEach(([k, validate]) => {
      const { error } = validate.validate(o[k])
      if (error) errors.push(error)
      return
    })
    if (errors.length > 0) throw new FieldValidationError(errors)
    if (!store) throw new StoreNotPreparedError()

    const ref = store.collection(this.collection).doc()
    await ref.create(o)
    this._id = ref.id

    return
  }

  toObject () {
    return Object.keys(this._fields).reduce((o, k) => {
      if (typeof this[k] !== undefined) o[k] = this[k]
      return o
    }, {})
  }
}

export function Field (validate: joi.AnySchema) {
  return (target: Collection, key: string) => {
    target.defineField(key, validate)
  }
}
