// Simple price blending utility
// Inputs: maps of itemId->priceInCopper from different sources
// Output: array of { itemId, price, source, confidence }

export function blendPrices({ tsm = {}, tuj = {}, nexus = {}, fallback = {} }, { prefer = ['tsm','tuj','nexus','fallback'] } = {}) {
  const itemIds = new Set([
    ...Object.keys(tsm),
    ...Object.keys(tuj),
    ...Object.keys(nexus),
    ...Object.keys(fallback),
  ])

  const results = []
  for (const idStr of itemIds) {
    const id = Number(idStr)
    let picked = null
    let source = null
    for (const s of prefer) {
      if (s === 'tsm' && tsm[idStr] != null) { picked = tsm[idStr]; source = 'tsm'; break }
      if (s === 'tuj' && tuj[idStr] != null) { picked = tuj[idStr]; source = 'tuj'; break }
      if (s === 'nexus' && nexus[idStr] != null) { picked = nexus[idStr]; source = 'nexus'; break }
      if (s === 'fallback' && fallback[idStr] != null) { picked = fallback[idStr]; source = 'fallback'; break }
    }
    if (picked == null) {continue}

    const confidence =
      source === 'tsm' ? 0.95 :
      source === 'tuj' ? 0.85 :
      source === 'nexus' ? 0.75 :
      0.60

    results.push({ itemId: id, price: Math.max(0, Math.floor(picked)), source, confidence })
  }
  return results
}

// Compute median unitPrice per item from a normalized auctions list
export function computeFallbackFromAuctions(normalizedAuctions = [], opts = {}) {
  const metric = (opts.metric || 'median').toLowerCase()
  const p = Math.max(0, Math.min(1, Number(opts.p ?? 0.5)))
  const perItem = new Map()
  for (const a of normalizedAuctions) {
    if (!a || !a.itemId) {continue}
    const up = a.unitPrice ?? null
    if (up == null || up <= 0) {continue}
    if (!perItem.has(a.itemId)) {perItem.set(a.itemId, [])}
    perItem.get(a.itemId).push(up)
  }
  const out = {}
  for (const [itemId, arr] of perItem.entries()) {
    arr.sort((x,y)=>x-y)
    if (metric === 'percentile') {
      if (arr.length === 0) {continue}
      const idx = Math.max(0, Math.min(arr.length - 1, Math.floor(p * (arr.length - 1))))
      out[itemId] = arr[idx]
    } else { // median (default)
      const mid = Math.floor(arr.length/2)
      const med = arr.length % 2 ? arr[mid] : Math.floor((arr[mid-1]+arr[mid])/2)
      out[itemId] = med
    }
  }
  return out
}
