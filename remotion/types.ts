import {z} from 'zod'

export const schema = z.object({
  image: z.string(),
  username: z.string(),
  content: z.string()
})
