import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function formatQuadraNumber(str) {
  if (!str) return ''
  const match = String(str).trim().match(/^0*(\d+)([A-Za-z]?)$/)
  if (!match) return String(str).trim()
  const numInt = parseInt(match[1], 10)
  const suffix = match[2] || ''
  if (numInt >= 1 && numInt <= 9) {
    return `0${numInt}${suffix}`
  }
  return `${numInt}${suffix}`
}

let lastApiWriteTime = 0

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'quadra-saver-api',
      handleHotUpdate({ file }) {
        const norm = file.replace(/\\/g, '/')
        if (
          Date.now() - lastApiWriteTime < 3000 &&
          (norm.endsWith('src/data/itaipuacuQuadras.json') ||
            norm.endsWith('src/data/itaipuacuQuadras.js'))
        ) {
          // Evita reload/reinício no navegador quando a própria UI salva ou exclui quadras
          return []
        }
      },
      configureServer(server) {
        server.middlewares.use('/api/save-quadra', (req, res, next) => {
          if (req.method === 'POST') {
            let body = ''
            req.on('data', (chunk) => {
              body += chunk
            })
            req.on('end', () => {
              try {
                const payload = JSON.parse(body)
                const itemsToSave = Array.isArray(payload.quadras) ? payload.quadras : [payload]
                const filePath = path.resolve(__dirname, 'src/data/itaipuacuQuadras.json')
                const rawData = fs.readFileSync(filePath, 'utf8')
                const data = JSON.parse(rawData)

                const results = []
                let addedAny = false

                for (const item of itemsToSave) {
                  const { id, number, rawNumber, lat, lng } = item
                  // Encontra a quadra correspondente: prioriza id exato em todo o array antes de cair para proximidade lat/lng
                  let index = id ? data.findIndex((q) => q.id === id) : -1
                  if (index === -1) {
                    const normTarget = formatQuadraNumber(rawNumber || number)
                    index = data.findIndex(
                      (q) =>
                        formatQuadraNumber(q.rawNumber || q.number) === normTarget &&
                        Math.abs(q.lat - lat) < 0.006 &&
                        Math.abs(q.lng - lng) < 0.006
                    )
                  }

                  if (index !== -1) {
                    data[index].lat = Number(Number(lat).toFixed(6))
                    data[index].lng = Number(Number(lng).toFixed(6))
                    const formatted = formatQuadraNumber(rawNumber || number || data[index].rawNumber)
                    if (formatted) {
                      data[index].number = formatted
                      data[index].rawNumber = formatted
                    }
                    results.push(data[index])
                  } else {
                    const formatted = formatQuadraNumber(rawNumber || number)
                    const newEntry = {
                      id: id || `${formatted}-${Math.round(lat * 100000)}-${Math.round(lng * 100000)}`,
                      number: formatted,
                      rawNumber: formatted,
                      lat: Number(Number(lat).toFixed(6)),
                      lng: Number(Number(lng).toFixed(6)),
                    }
                    data.push(newEntry)
                    results.push(newEntry)
                    addedAny = true
                  }
                }

                lastApiWriteTime = Date.now()
                const jsonStr = JSON.stringify(data, null, 2)
                fs.writeFileSync(filePath, jsonStr, 'utf8')

                // Também mantém espelho em itaipuacuQuadras.js caso referenciado
                const jsPath = path.resolve(__dirname, 'src/data/itaipuacuQuadras.js')
                fs.writeFileSync(jsPath, `export default ${jsonStr};\n`, 'utf8')

                res.setHeader('Content-Type', 'application/json')
                res.end(
                  JSON.stringify({
                    success: true,
                    added: addedAny,
                    count: results.length,
                    updated: results[0],
                    quadra: results[0],
                    quadras: results,
                  })
                )
                return
              } catch (err) {
                res.statusCode = 500
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ error: err.message }))
              }
            })
            return
          }
          next()
        })

        server.middlewares.use('/api/delete-quadra', (req, res, next) => {
          if (req.method === 'POST') {
            let body = ''
            req.on('data', (chunk) => {
              body += chunk
            })
            req.on('end', () => {
              try {
                const { id, number, rawNumber, lat, lng } = JSON.parse(body)
                const filePath = path.resolve(__dirname, 'src/data/itaipuacuQuadras.json')
                const rawData = fs.readFileSync(filePath, 'utf8')
                const data = JSON.parse(rawData)

                let index = id ? data.findIndex((q) => q.id === id) : -1
                if (index === -1 && lat != null && lng != null) {
                  const normTarget = formatQuadraNumber(rawNumber || number)
                  index = data.findIndex(
                    (q) =>
                      formatQuadraNumber(q.rawNumber || q.number) === normTarget &&
                      Math.abs(q.lat - lat) < 0.002 &&
                      Math.abs(q.lng - lng) < 0.002
                  )
                }

                if (index !== -1) {
                  const [deleted] = data.splice(index, 1)
                  lastApiWriteTime = Date.now()

                  const jsonStr = JSON.stringify(data, null, 2)
                  fs.writeFileSync(filePath, jsonStr, 'utf8')

                  const jsPath = path.resolve(__dirname, 'src/data/itaipuacuQuadras.js')
                  fs.writeFileSync(jsPath, `export default ${jsonStr};\n`, 'utf8')

                  res.setHeader('Content-Type', 'application/json')
                  res.end(JSON.stringify({ success: true, deleted, total: data.length }))
                  return
                }

                res.statusCode = 404
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ error: 'Quadra não encontrada para exclusão' }))
              } catch (err) {
                res.statusCode = 500
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ error: err.message }))
              }
            })
            return
          }
          next()
        })
      },
    },
  ],
})
