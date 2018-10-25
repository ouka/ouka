import * as Functions from 'firebase-functions'
import * as NodeRSA from 'node-rsa'

import { auth } from 'firebase-admin'

import config from '~/config'
import { firestore } from '~/preload'

const runtimeOpts = {
  timeoutSeconds: 30,
  memory: '128MB' as '128MB'
}

const Accounts = () => firestore.collection('accounts')

/**
 * TODO: Add error reporting!
 */

export const onCreate = Functions.runWith(runtimeOpts).auth.user().onCreate((user) => {
  // TODO NOTE:
  // * MUST implement client collectly to prevent XSS! (client side)
  // * MUST implement colision check of userpart!
  const userpart = user.email.split('@')[0].slice(0, 20)
  const key = new NodeRSA({ b: 2048 })

  return firestore.runTransaction(async transaction => {
    // try to recovery
    if (user.emailVerified) {
      const query = Accounts().where('email', '==', user.email).limit(1)
      const snapshot = await transaction.get(query)

      if (!snapshot.empty) {
        if (!snapshot.docs[0].data().attributes.gone) {
          // no new account that has same address (bug?)
          throw new Error('No new acccout that has same e-mail address!')
        }

        transaction.update(snapshot.docs[0].ref, {
          'attributes.gone': false
        })
        return
      }
    }

    transaction.set(Accounts().doc(user.uid), {
      userpart,
      uid: user.uid,
      email: user.emailVerified ? user.email : null,
      keyring: {
        key: key.exportKey('pkcs1-private-pem').toString(),
        pub: key.exportKey('pkcs1-public-pem').toString()
      },
      attributes: {
        admin: user.emailVerified && config.service.owner.email === user.email,
        gone: false,
        frozen: false
      }
    })
  })

})

export const onDelete = Functions.runWith(runtimeOpts).auth.user().onDelete((user) => {
  return firestore.runTransaction(async transaction => {
    const snapshot = await transaction.get(Accounts().where("uid", "==", user.uid))
    snapshot.forEach(doc => {
      transaction.update(doc.ref, {
        'attributes.gone': true
      })
    })
  })
})
