import { Router } from 'express'
import { createFragmentMediaStream } from '../services/fragmentMediaService.js'

const router = Router()

router.get('/:filename', (req, res) => {
  const stream = createFragmentMediaStream(req.params.filename)
  if (!stream) {
    res.status(404).json({ code: 404, message: '图片不存在' })
    return
  }

  const ext = req.params.filename.split('.').pop()?.toLowerCase()
  const mime =
    ext === 'png'
      ? 'image/png'
      : ext === 'jpg' || ext === 'jpeg'
        ? 'image/jpeg'
        : ext === 'gif'
          ? 'image/gif'
          : ext === 'webp'
            ? 'image/webp'
            : ext === 'svg'
              ? 'image/svg+xml'
              : 'application/octet-stream'

  res.setHeader('Content-Type', mime)
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  stream.pipe(res)
})

export default router
