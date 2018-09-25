import * as Functions from 'firebase-functions'

import config from '../config'
import { firestore } from '../preload'

export const onCreate = Functions.auth.user().onCreate(async (user) => {
  const ref = firestore.collection('accounts').doc()
  await ref.set({
    attributes: [
      ...(config.service.owner.email == user.email && user.emailVerified ? ['admin'] : []),
      'user'
    ],
    userpart: ref.id,
    uid: user.uid
  })
})

export const onDelete = Functions.auth.user().onDelete(async (user) => {
  const qs = await firestore.collection('accounts').where("uid", "==", user.uid).get()
  const p = []
  qs.forEach(
    doc => p.push(
      doc.ref.update({
        archived: true
      })
    )
  )
  await Promise.all(p)
})
