import { FILE_TYPES, type FileType } from './documents.ts'
import type { Reading } from './reading.ts'
import { roleCan, type Role } from './roles.ts'

/**
 * A person's photo on their page (ADR 0063), in place of their initials
 * (ADR 0038). Kept as documents' files are (ADR 0029): in the storage
 * bucket, read only through the server, deleted when it's replaced,
 * removed, or the person is erased. Devices are sent when it was put up,
 * never where it's kept; the picture comes from the server by its address,
 * which changes with each new photo.
 *
 * A face is personal data (the design system's imagery.md): their own,
 * or one they gave the office. Who can put one up or take it down: the
 * person themselves, and whoever can change crew (the office, directors
 * and heads of department).
 */

/** The server actions, recorded in the history as commands are. */
export const PHOTO_ACTIONS = { put: 'person.photo', remove: 'person.photoRemove' } as const
export type PhotoAction = (typeof PHOTO_ACTIONS)[keyof typeof PHOTO_ACTIONS]

/** What a browser can show as it is: an iPhone's HEIC isn't, so the device sends a JPEG made from it, or says to. */
export const PHOTO_TYPES = ['jpeg', 'png', 'webp'] as const satisfies readonly FileType[]
export type PhotoType = (typeof PHOTO_TYPES)[number]
export const isPhotoType = (t: FileType): t is PhotoType => (PHOTO_TYPES as readonly string[]).includes(t)

/** The side of the square a device makes of a photo before sending it: twice the largest avatar, for sharp screens. */
export const PHOTO_SIDE = 512

export const NOT_A_PHOTO = "That isn't a photo the app can show. Choose a JPEG, PNG or WebP photo, or take one with the camera."
export const PHOTO_REFUSAL = 'Only they, the office, directors and heads of department can change the photo on this page.'
export const PHOTOS_WAIT = "Photos wait on the storage bucket, which isn't set up on this server."

/** The address of a person's photo: a new one is a new address, so a browser keeps each for as long as it likes. */
export const photoPath = (personId: string, at: string) => `/api/people/${encodeURIComponent(personId)}/photo?v=${encodeURIComponent(at)}`

/** The type a photo is sent back as. */
export const photoMime = (t: PhotoType) => FILE_TYPES[t].mime

/** Whether someone can put up or take down this person's photo: themselves, or a role that changes crew. No role is held to nothing. */
export function mayChangePhoto(role: Role | null | undefined, myPersonId: string | undefined, personId: string): boolean {
  return !role || roleCan(role, 'crew') || myPersonId === personId
}

/** Whether this reader is sent someone's photo: everyone but a freelancer signed in, who reads nobody's details but their own (ADR 0062). */
export const readsPhotoOf = (r: Reading, personId: string) => (r.details ?? 'all') !== 'own' || r.personId === personId
