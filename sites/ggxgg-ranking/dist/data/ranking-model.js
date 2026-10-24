// Rank the complete draft pool once; every view retains these overall ranks.
export function rankEntries(rows, priorities) {
  const ranked = rows
    .map((row) => ({
      ...row,
      priority: priorities.get(row.name) ?? null,
    }))
    .sort((a, b) => {
      const av = Number.isFinite(a.priority) ? a.priority : Infinity
      const bv = Number.isFinite(b.priority) ? b.priority : Infinity
      return av - bv || a.name.localeCompare(b.name)
    })
  return ranked.map((row, index) => ({
    ...row,
    rank: Number.isFinite(row.priority) ? index + 1 : null,
  }))
}

export function selectEntries(
  ranked,
  { type = 'all', query = '', hero = '', sort = 'priority', direction = 'asc' } = {},
) {
  const search = query.trim().toLocaleLowerCase()
  return ranked
    .filter((row) => {
      if (type === 'heroes' && !row.isHero) return false
      if (type === 'skills' && row.isHero) return false
      if (type === 'normal' && (row.isHero || row.isUltimate)) return false
      if (type === 'ultimate' && (row.isHero || !row.isUltimate)) return false
      if (hero && row.heroName !== hero) return false
      return (
        !search ||
        [row.displayName, row.englishName, row.name, row.heroDisplayName, row.heroName].some(
          (value) => (value || '').toLocaleLowerCase().includes(search),
        )
      )
    })
    .sort((a, b) => {
      const av = a[sort]
      const bv = b[sort]
      if (Number.isFinite(av) && !Number.isFinite(bv)) return -1
      if (!Number.isFinite(av) && Number.isFinite(bv)) return 1
      const byValue =
        Number.isFinite(av) && Number.isFinite(bv) ? (direction === 'asc' ? av - bv : bv - av) : 0
      return byValue || (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.name.localeCompare(b.name)
    })
}
