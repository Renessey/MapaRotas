import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { DatabaseSync } from 'node:sqlite'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const dbPath = path.resolve(__dirname, 'src/data/quadras.db')
const jsonPath = path.resolve(__dirname, 'src/data/itaipuacuQuadras.json')

let sqliteDb = null

function getDatabase() {
  if (sqliteDb) return sqliteDb
  try {
    sqliteDb = new DatabaseSync(dbPath)
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS quadras (
        id TEXT PRIMARY KEY,
        number TEXT,
        rawNumber TEXT,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        x REAL,
        y REAL
      );
      CREATE INDEX IF NOT EXISTS idx_quadras_coords ON quadras(lat, lng);
    `)

    const countRow = sqliteDb.prepare('SELECT count(*) as total FROM quadras').get()
    if (!countRow || countRow.total === 0) {
      if (fs.existsSync(jsonPath)) {
        const raw = fs.readFileSync(jsonPath, 'utf8')
        const items = JSON.parse(raw)
        const insertStmt = sqliteDb.prepare(`
          INSERT OR REPLACE INTO quadras (id, number, rawNumber, lat, lng, x, y)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        sqliteDb.exec('BEGIN TRANSACTION;')
        for (const q of items) {
          const num = formatQuadraNumber(q.rawNumber || q.number)
          const qId = q.id || `${num}-${Math.round(q.lat * 100000)}-${Math.round(q.lng * 100000)}`
          insertStmt.run(qId, num, num, Number(Number(q.lat).toFixed(6)), Number(Number(q.lng).toFixed(6)), q.x || null, q.y || null)
        }
        sqliteDb.exec('COMMIT;')
      }
    }
  } catch (err) {
    console.error('Erro ao inicializar banco SQLite de quadras:', err)
  }
  return sqliteDb
}

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
  server: {
    host: true,
    port: 5173,
  },
  plugins: [
    react(),
    {
      name: 'quadra-saver-api',
      handleHotUpdate({ file }) {
        const norm = file.replace(/\\/g, '/')
        if (
          Date.now() - lastApiWriteTime < 3000 &&
          norm.endsWith('src/data/itaipuacuQuadras.json')
        ) {
          // Evita reload/reinício no navegador quando a própria UI salva ou exclui quadras
          return []
        }
      },
      configureServer(server) {
        // Consulta pontos filtrados por Bounding Box no SQLite com índice composto (lat, lng)
        server.middlewares.use('/api/pontos', (req, res, next) => {
          if (req.method === 'GET' || req.method === 'POST') {
            const handleQuery = (params) => {
              try {
                const db = getDatabase()
                if (!db) {
                  res.statusCode = 500
                  res.setHeader('Content-Type', 'application/json')
                  res.end(JSON.stringify({ error: 'Banco SQLite indisponível' }))
                  return
                }

                const norte = parseFloat(params.norte ?? params.north)
                const sul = parseFloat(params.sul ?? params.south)
                const leste = parseFloat(params.leste ?? params.east)
                const oeste = parseFloat(params.oeste ?? params.west)
                const limit = Math.min(Math.max(parseInt(params.limit || '1200', 10), 1), 3000)

                let rows = []
                if (!isNaN(norte) && !isNaN(sul) && !isNaN(leste) && !isNaN(oeste)) {
                  const minLat = Math.min(sul, norte)
                  const maxLat = Math.max(sul, norte)
                  const minLng = Math.min(oeste, leste)
                  const maxLng = Math.max(oeste, leste)

                  const stmt = db.prepare(`
                    SELECT id, number, rawNumber, lat, lng, x, y
                    FROM quadras
                    WHERE lat BETWEEN ? AND ?
                      AND lng BETWEEN ? AND ?
                    LIMIT ?
                  `)
                  rows = stmt.all(minLat, maxLat, minLng, maxLng, limit)
                } else {
                  const stmt = db.prepare(`
                    SELECT id, number, rawNumber, lat, lng, x, y
                    FROM quadras
                    LIMIT ?
                  `)
                  rows = stmt.all(limit)
                }

                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ success: true, count: rows.length, quadras: rows }))
              } catch (err) {
                res.statusCode = 500
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ error: err.message }))
              }
            }

            if (req.method === 'GET') {
              const url = new URL(req.url, 'http://localhost')
              const params = Object.fromEntries(url.searchParams.entries())
              handleQuery(params)
              return
            }

            if (req.method === 'POST') {
              let body = ''
              req.on('data', (chunk) => { body += chunk })
              req.on('end', () => {
                try {
                  const params = JSON.parse(body || '{}')
                  handleQuery(params)
                } catch {
                  handleQuery({})
                }
              })
              return
            }
          }
          next()
        })

        // Grava o conjunto completo de quadras ativas da tela do PC direto no arquivo físico e no SQLite
        server.middlewares.use('/api/sync-all-quadras', (req, res, next) => {
          if (req.method === 'POST') {
            let body = ''
            req.on('data', (chunk) => {
              body += chunk
            })
            req.on('end', () => {
              try {
                const payload = JSON.parse(body)
                if (Array.isArray(payload.quadras) && payload.quadras.length > 0) {
                  const filePath = path.resolve(__dirname, 'src/data/itaipuacuQuadras.json')
                  lastApiWriteTime = Date.now()
                  const jsonStr = JSON.stringify(payload.quadras, null, 2)
                  fs.writeFileSync(filePath, jsonStr, 'utf8')

                  // Sincroniza em transação atômica no SQLite
                  const db = getDatabase()
                  if (db) {
                    const insertStmt = db.prepare(`
                      INSERT OR REPLACE INTO quadras (id, number, rawNumber, lat, lng, x, y)
                      VALUES (?, ?, ?, ?, ?, ?, ?)
                    `)
                    db.exec('BEGIN TRANSACTION;')
                    db.exec('DELETE FROM quadras;')
                    for (const q of payload.quadras) {
                      const formatted = formatQuadraNumber(q.rawNumber || q.number)
                      const qId = q.id || `${formatted}-${Math.round(q.lat * 100000)}-${Math.round(q.lng * 100000)}`
                      insertStmt.run(
                        qId,
                        formatted,
                        formatted,
                        Number(Number(q.lat).toFixed(6)),
                        Number(Number(q.lng).toFixed(6)),
                        q.x || null,
                        q.y || null
                      )
                    }
                    db.exec('COMMIT;')
                  }

                  res.setHeader('Content-Type', 'application/json')
                  res.end(JSON.stringify({ success: true, count: payload.quadras.length }))
                  return
                }
                res.statusCode = 400
                res.end(JSON.stringify({ error: 'Array quadras inválido' }))
              } catch (err) {
                res.statusCode = 500
                res.end(JSON.stringify({ error: err.message }))
              }
            })
            return
          }
          next()
        })

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

                // Sincroniza também no banco SQLite
                const db = getDatabase()
                if (db) {
                  const upsertStmt = db.prepare(`
                    INSERT INTO quadras (id, number, rawNumber, lat, lng, x, y)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                      number = excluded.number,
                      rawNumber = excluded.rawNumber,
                      lat = excluded.lat,
                      lng = excluded.lng,
                      x = excluded.x,
                      y = excluded.y
                  `)
                  db.exec('BEGIN TRANSACTION;')
                  for (const item of results) {
                    upsertStmt.run(
                      item.id,
                      item.number,
                      item.rawNumber,
                      item.lat,
                      item.lng,
                      item.x || null,
                      item.y || null
                    )
                  }
                  db.exec('COMMIT;')
                }

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

                  // Remove também no banco SQLite
                  const db = getDatabase()
                  if (db && deleted) {
                    db.prepare('DELETE FROM quadras WHERE id = ? OR (lat = ? AND lng = ?)').run(deleted.id, deleted.lat, deleted.lng)
                  }

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
  build: {
    cssMinify: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      treeshake: true,
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'vendor-react'
          }
          if (id.includes('node_modules/maplibre-gl/')) {
            return 'vendor-maplibre'
          }
          if (id.includes('node_modules/xlsx/')) {
            return 'vendor-xlsx'
          }
          if (id.includes('node_modules/lucide-react/')) {
            return 'vendor-lucide'
          }
        },
      },
    },
  },
})
