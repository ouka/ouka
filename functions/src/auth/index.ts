import * as Functions from 'firebase-functions'
import * as NodeRSA from 'node-rsa'

import config from '../config'
import { firestore } from '../preload'
import { Certificate } from 'crypto';

const runtimeOpts = {
  timeoutSeconds: 30,
  memory: '128MB' as '128MB'
}

export const onCreate = Functions.runWith(runtimeOpts).auth.user().onCreate(async (user) => {
  // TODO NOTE:
  // * MUST implement client collectly to prevent XSS! (client side)
  // * MUST implement colision check of userpart!
  const userpart = user.email.split('@')[0].slice(0, 20)
  const key = new NodeRSA({b: 2048})

  await firestore.collection('accounts').doc().set({
    attributes: [
      ...(config.service.owner.email == user.email && user.emailVerified ? ['admin'] : []),
      'user'
    ],
    userpart,
    uid: user.uid,
    keyring: {
      key: key.exportKey('pkcs1-private-pem').toString(),
      pub: key.exportKey('pkcs1-public-pem').toString()
    }
  })
})

export const onDelete = Functions.runWith(runtimeOpts).auth.user().onDelete(async (user) => {
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
