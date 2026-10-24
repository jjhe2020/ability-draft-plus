import { rankEntries, selectEntries } from './data/ranking-model.js'

const $ = (selector, context = document) => context.querySelector(selector)
const $$ = (selector, context = document) => [...context.querySelectorAll(selector)]
const PAGE_SIZE = 30
const STORAGE_KEY = 'ggxgg-ranking:priority:v1'
const numberFormat = new Intl.NumberFormat('zh-CN')
const state = {
  data: null,
  engine: null,
  config: null,
  calculation: null,
  rows: [],
  filtered: [],
  type: 'all',
  query: '',
  hero: '',
  sort: 'priority',
  direction: 'asc',
  visible: PAGE_SIZE,
  activeDrawer: null,
  lastFocus: null,
  toastTimer: null,
}

function escapeHTML(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  )
}
function decimal(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—'
}
function percentage(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : '—'
}
function isHeroView() {
  return state.type === 'heroes'
}
function entryLabel() {
  return {
    all: '项目',
    skills: '技能',
    normal: '普通技能',
    ultimate: '终极技能',
    heroes: '英雄模型',
  }[state.type]
}
function entryType(row) {
  return row.isHero ? '英雄模型' : row.isUltimate ? '终极技能' : '普通技能'
}
function isDefault(config = state.config) {
  const defaults = state.engine.DEFAULT_ABILITY_PRIORITY
  return (
    config.winWeight === defaults.winWeight &&
    config.pickWeight === defaults.pickWeight &&
    config.formula.trim() === defaults.formula.trim()
  )
}
function toast(message) {
  clearTimeout(state.toastTimer)
  $('#toast').textContent = message
  $('#toast').hidden = false
  state.toastTimer = setTimeout(() => {
    $('#toast').hidden = true
  }, 3600)
}
function iconMarkup(ability, eager = false) {
  const first = [...(ability.displayName || ability.englishName || '?')][0]
  if (!ability.icon)
    return `<span class="icon-fallback" aria-hidden="true">${escapeHTML(first)}</span>`
  return `<img class="ability-icon" src="${escapeHTML(ability.icon)}" alt="" loading="${eager ? 'eager' : 'lazy'}" width="44" height="44" data-fallback="${escapeHTML(first)}" />`
}
function attachIconFallbacks(context) {
  $$('img[data-fallback]', context).forEach((img) => {
    const replace = () => {
      const span = document.createElement('span')
      span.className = 'icon-fallback'
      span.setAttribute('aria-hidden', 'true')
      span.textContent = img.dataset.fallback
      img.replaceWith(span)
    }
    img.addEventListener('error', replace, { once: true })
    if (img.complete && img.naturalWidth === 0) replace()
  })
}
function setMetadata() {
  const { meta, abilities, heroes } = state.data
  $('#ability-count').textContent = numberFormat.format(abilities.length)
  $('#hero-count').textContent = numberFormat.format(heroes.length)
  $('#patch').textContent = meta.patch || '未标注'
  $('#snapshot-label').textContent = meta.sourceUpdatedAt
    ? `数据更新于 ${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(new Date(meta.sourceUpdatedAt))}（北京时间）`
    : meta.dataAsOf
      ? `${meta.dataAsOf} 数据快照`
      : `读取于 ${new Date(meta.fetchedAt).toLocaleDateString('zh-CN')}`
  $('#snapshot-label').title = meta.sourceNote || ''
  $('#windrun-link').href = meta.sourceUrl || 'https://windrun.io/abilities'
  $('#count-all').textContent = abilities.length + heroes.length
  $('#count-skills').textContent = abilities.length
  $('#count-normal').textContent = abilities.filter((row) => !row.isUltimate).length
  $('#count-ultimate').textContent = abilities.filter((row) => row.isUltimate).length
  $('#count-heroes').textContent = heroes.length
  if (meta.sourceKind === 'excel-reference') {
    $('#snapshot-notice').hidden = false
    $('#snapshot-note').textContent =
      `${meta.patch} · ${meta.dataAsOf} 数据快照。Windrun 当前数据暂不可用，现展示你提供的 Excel 参考表中的历史数据。`
    $('#source-note').textContent = '数据：Windrun · Excel 参考快照　/　图标与中文名：Valve'
  } else {
    $('#snapshot-notice').hidden = true
    $('#source-note').textContent = `数据：${meta.sourceLabel || 'Windrun'}　/　图标与中文名：Valve`
  }
  const heroOptions = [
    ...new Map(
      [...abilities, ...heroes].map((row) => [row.heroName, row.heroDisplayName || row.heroName]),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1], 'zh-CN'))
  $('#hero-filter').innerHTML =
    '<option value="">全部英雄</option>' +
    heroOptions
      .map(
        ([name, display]) => `<option value="${escapeHTML(name)}">${escapeHTML(display)}</option>`,
      )
      .join('')
  $('#export-csv').disabled = false
}
function calculate(config) {
  return state.engine.calculateAbilityPriorities(state.data.population, config)
}
function applyCalculation(config, result = calculate(config)) {
  state.config = config
  state.calculation = result
  state.rows = rankEntries([...state.data.abilities, ...state.data.heroes], result.priorities)
  $('#formula-state').classList.toggle('custom', !isDefault())
  $('#formula-state').innerHTML =
    `<span class="status-dot"></span>${isDefault() ? 'GGXGG 默认规则' : '正在使用自定义规则'}`
  render()
}
function render() {
  const label = entryLabel()
  const heroView = isHeroView()
  $('#ranking-title-label').textContent = state.type === 'all' ? '综合排名' : `${label}筛选`
  $('#identity-heading').textContent = heroView
    ? '英雄模型'
    : state.type === 'all'
      ? '技能 / 英雄模型'
      : '技能 / 所属英雄'
  $('#search').placeholder = heroView ? '搜索英雄模型 / 英文名' : '搜索技能 / 英雄'
  $('#search').setAttribute(
    'aria-label',
    heroView ? '搜索中文或英文英雄模型' : '搜索中文、英文技能或英雄',
  )
  $('.mobile-table-note').textContent = '点击名称查看数据与公式；分类筛选保留总榜名次。'
  $('.table-footer-note').textContent = '点击名称，查看数据与公式'
  state.filtered = selectEntries(state.rows, state)
  $('#result-count').textContent = state.filtered.length
  const rows = state.filtered.slice(0, state.visible)
  $('#table-scroll').setAttribute('aria-busy', 'false')
  $('#ranking-body').innerHTML = rows.length
    ? rows
        .map(
          (
            ability,
            index,
          ) => `<tr class="ability-row${ability.isHero ? ' hero-model-row' : ''}" tabindex="0" data-name="${escapeHTML(ability.name)}" aria-label="第 ${ability.rank || '未'} 名，${escapeHTML(ability.displayName)}，${escapeHTML(ability.isHero ? '英雄模型' : ability.heroDisplayName)}，GGXGG 选位 ${decimal(ability.priority)}，查看详情">
    <td class="rank-cell ${ability.rank <= 3 && ability.rank ? 'top-rank' : ''}"><span class="rank-wrap">${ability.rank <= 3 && ability.rank ? '<span class="rank-indicator" aria-hidden="true"></span>' : ''}${ability.rank ? String(ability.rank).padStart(2, '0') : '—'}</span></td>
    <td><div class="ability-identity">${iconMarkup(ability, index < 12)}<div class="ability-identity-text"><div class="ability-name-line"><span class="ability-name">${escapeHTML(ability.displayName || ability.englishName || ability.name)}</span>${ability.isHero ? '<span class="ultimate-tag model-tag">模型</span>' : ability.isUltimate ? '<span class="ultimate-tag">终极</span>' : ''}</div><span class="hero-name">${escapeHTML(ability.isHero ? ability.englishName || '英雄模型' : ability.heroDisplayName || ability.heroName)}</span></div></div></td>
    <td class="numeric winrate-cell">${percentage(ability.winrate)}</td><td class="numeric stat-cell">${decimal(ability.pickRate)}</td><td class="numeric stat-cell">${percentage(ability.draftFrequency)}</td>
    <td class="numeric priority-cell ${ability.priority === null ? 'invalid' : ''}">${decimal(ability.priority)}</td><td class="row-arrow" aria-hidden="true">↗</td>
  </tr>`,
        )
        .join('')
    : `<tr class="state-row"><td colspan="7"><strong>没有找到匹配的${label}</strong>${heroView ? '试试其他英雄的中文名或英文名。' : '试试其他技能名、英文名或英雄名。'}<br /><button class="text-button" id="empty-clear">清除筛选，返回综合总榜 →</button></td></tr>`
  attachIconFallbacks($('#ranking-body'))
  $('#empty-clear')?.addEventListener('click', clearFilters)
  $('#table-status').textContent = rows.length
    ? `已显示 ${rows.length} / ${state.filtered.length} 项`
    : '0 项匹配结果'
  $('#load-more').hidden = rows.length >= state.filtered.length
  $('#load-more').textContent =
    `再看 ${Math.min(PAGE_SIZE, state.filtered.length - rows.length)} 项 ↓`
  const filters = []
  if (state.query) filters.push(`搜索「${state.query}」`)
  if (state.hero) filters.push($('#hero-filter').selectedOptions[0].textContent)
  $('#active-filter-bar').hidden = filters.length === 0 && state.type === 'all'
  if (state.type !== 'all')
    filters.unshift(`分类：${$('.tab.active').textContent.replace(/\s+/g, ' ').trim()}`)
  $('#filter-description').textContent = filters.join(' · ')
  $$('.sort-button').forEach((button) => {
    const selected = button.dataset.sort === state.sort
    button.classList.toggle('is-sorted', selected)
    button
      .closest('th')
      .setAttribute(
        'aria-sort',
        selected ? (state.direction === 'asc' ? 'ascending' : 'descending') : 'none',
      )
    $('.sort-icon', button).textContent = selected ? (state.direction === 'asc' ? '↓' : '↑') : '↕'
  })
}
function clearFilters() {
  state.query = ''
  state.hero = ''
  state.visible = PAGE_SIZE
  $('#search').value = ''
  $('#hero-filter').value = ''
  setType('all')
  $('#search').focus()
}
function setType(type) {
  if (!['all', 'skills', 'normal', 'ultimate', 'heroes'].includes(type)) return
  state.type = type
  state.visible = PAGE_SIZE
  const hash = isHeroView() ? '#heroes' : state.type === 'skills' ? '#skills' : ''
  if (location.hash !== hash)
    history.replaceState(null, '', `${location.pathname}${location.search}${hash}`)
  $$('.tab').forEach((tab) => {
    const selected = tab.dataset.type === type
    tab.classList.toggle('active', selected)
    tab.setAttribute('aria-selected', String(selected))
    tab.tabIndex = selected ? 0 : -1
  })
  render()
}
function openDrawer(id) {
  if (state.activeDrawer) $(`#${state.activeDrawer}`).hidden = true
  else state.lastFocus = document.activeElement
  state.activeDrawer = id
  $('#drawer-overlay').hidden = false
  $(`#${id}`).hidden = false
  document.body.classList.add('drawer-open')
  $(`#${id} .close-drawer`).focus()
}
function closeDrawer() {
  if (!state.activeDrawer) return
  $(`#${state.activeDrawer}`).hidden = true
  state.activeDrawer = null
  $('#drawer-overlay').hidden = true
  document.body.classList.remove('drawer-open')
  if (state.lastFocus?.isConnected) state.lastFocus.focus()
}
function fillForm(config) {
  $('#apply-formula').disabled = false
  $('#win-weight').value = config.winWeight
  $('#pick-weight').value = config.pickWeight
  $('#formula-expression').value = config.formula
  $('#formula-feedback').textContent = ''
  $('#formula-feedback').classList.remove('error')
  $('#formula-preview').hidden = true
}
function openFormula() {
  if (!state.data) {
    toast('数据尚未载入，请稍后重试。')
    return
  }
  fillForm(state.config)
  openDrawer('formula-drawer')
}
function readForm() {
  const winValue = $('#win-weight').value.trim()
  const pickValue = $('#pick-weight').value.trim()
  if (!winValue || !pickValue) throw new Error('请填写胜率系数和选位系数。')
  return state.engine.validateAbilityPrioritySettings({
    mode: 'custom',
    winWeight: Number(winValue),
    pickWeight: Number(pickValue),
    formula: $('#formula-expression').value,
  })
}
function previewFormula() {
  try {
    const config = readForm()
    const result = calculate(config)
    $('#apply-formula').disabled = false
    if (result.count === 0) throw new Error('没有可计算的数据，请检查数据源。')
    const previewRows = rankEntries(
      [...state.data.abilities, ...state.data.heroes],
      result.priorities,
    )
    const top = selectEntries(previewRows, { ...state, sort: 'priority', direction: 'asc' })
      .filter((row) => Number.isFinite(row.priority))
      .slice(0, 5)
    $('#formula-feedback').classList.remove('error')
    $('#formula-feedback').textContent = `公式有效。已使用 ${result.count} 条总体数据完成计算。`
    $('#formula-preview').hidden = false
    $('#formula-preview').innerHTML =
      `<div class="preview-title"><span>新规则 · ${state.type === 'all' && !state.query && !state.hero ? '总榜前五' : '筛选前五'} · 总榜名次</span><span>当前 → 预览选位</span></div>` +
      (top.length
        ? top
            .map(
              (row) =>
                `<div class="preview-row"><span>${String(row.rank).padStart(2, '0')}</span><span>${escapeHTML(row.displayName)}${row.isHero ? ' · 模型' : ''}</span><span class="preview-old">${decimal(state.calculation.priorities.get(row.name))}</span><span>→</span><span class="preview-new">${decimal(result.priorities.get(row.name))}</span></div>`,
            )
            .join('')
        : '<p class="preview-empty">当前筛选没有匹配项，可清除筛选后预览。</p>')
    return { config, result }
  } catch (error) {
    $('#apply-formula').disabled = true
    $('#formula-feedback').classList.add('error')
    $('#formula-feedback').textContent = error.message || '公式无法计算，请检查输入。'
    $('#formula-preview').hidden = true
    return null
  }
}
function openDetail(name) {
  const row = state.rows.find((ability) => ability.name === name)
  if (!row) return
  const { win, pick, raw } = state.calculation
  const winZ = win.std > 0 ? (row.winrate - win.mean) / win.std : 0
  const pickZ = pick.std > 0 ? (row.pickRate - pick.mean) / pick.std : 0
  let rawValue = null
  try {
    rawValue = state.engine.compilePriorityFormula(state.config.formula)({
      winWeight: state.config.winWeight,
      pickWeight: state.config.pickWeight,
      winZ,
      pickZ,
      pickFrequency: row.draftFrequency,
      winrate: row.winrate,
      avgPick: row.pickRate,
      winMean: win.mean,
      winStd: win.std,
      pickMean: pick.mean,
      pickStd: pick.std,
    })
  } catch {
    /* Unavailable stats are explicit. */
  }
  const sourceDate = state.data.meta.dataAsOf || '未注明日期'
  const label = row.isHero ? '英雄模型' : '技能'
  $('#detail-section-eyebrow').textContent = `${label}数据与计算依据`
  $('#close-detail').setAttribute('aria-label', `关闭${label}详情`)
  $('#detail-body').innerHTML =
    `<div class="detail-identity">${iconMarkup(row, true)}<div><h2 id="detail-title">${escapeHTML(row.displayName)}</h2><p class="detail-hero">${escapeHTML(row.isHero ? '征召英雄模型' : row.heroDisplayName)} <span class="ultimate-tag">${entryType(row)}</span></p>${row.englishName ? `<p class="detail-english">${escapeHTML(row.englishName)}</p>` : ''}</div></div>
    <div class="detail-score"><div><span class="detail-score-label">GGXGG 公式选位 · 越低越强</span><div class="detail-score-value">${decimal(row.priority)}</div></div><div class="detail-score-rank">总榜排名<strong># ${row.rank || '—'}</strong>共 ${state.rows.length} 项</div></div>
    <div class="detail-stat-grid"><div class="detail-stat"><span>胜率</span><strong>${percentage(row.winrate)}</strong><small>总体均值 ${percentage(win.mean)}</small></div><div class="detail-stat"><span>平均选位</span><strong>${decimal(row.pickRate)}</strong><small>越早选取，数值越小</small></div><div class="detail-stat"><span>选取频率</span><strong>${percentage(row.draftFrequency)}</strong><small>Windrun 选取频率</small></div></div>
    <h3 class="detail-section-title">这个选位是怎样算出的？</h3>
    <div class="calculation-step"><span class="step-number">01</span><p>用完整总体标准化胜率与平均选位。<br /><code>winZ = ${decimal(winZ, 4)}　pickZ = ${decimal(pickZ, 4)}</code></p></div>
    <div class="calculation-step"><span class="step-number">02</span><p>代入${isDefault() ? ' GGXGG 默认' : '当前自定义'}表达式。<br /><code>原始强度 = ${decimal(rawValue, 4)}</code></p></div>
    <div class="detail-formula">${escapeHTML(state.config.formula)}</div>
    <div class="calculation-step"><span class="step-number">03</span><p>${raw.std > 0 ? `将原始强度再次标准化，再换算到平均选位尺度。<br /><code>(${decimal(rawValue, 4)} − ${decimal(raw.mean, 4)}) ÷ ${decimal(raw.std, 4)}<br />× ${decimal(pick.std, 4)} + ${decimal(pick.mean, 4)} = ${decimal(row.priority, 2)}</code>` : `当前公式对所有数据产生相同强度，标准差为 0；公式选位统一取总体平均选位。<br /><code>公式选位 = ${decimal(pick.mean, 2)}</code>`}</p></div>
    <p class="detail-note">统计总体：${state.calculation.count} 条数据，含技能与英雄模型；所有项目共同计算并统一排名，分类筛选不会改变总榜名次。<br />数据版本：${escapeHTML(state.data.meta.patch || '未标注')} · ${escapeHTML(sourceDate)}。${state.data.meta.sourceKind === 'excel-reference' ? '本页使用 Excel 参考表中的 Windrun 历史快照。' : ''}<br />${row.isHero ? '这里比较的是英雄模型本身的征召表现，不代表该英雄自带技能的强度。' : '公式选位用于比较选择优先级；实际选择还应考虑英雄模型与技能组合。'}</p>
    <button class="text-button detail-windrun" id="detail-edit-formula">调整这套计算规则 <span aria-hidden="true">↗</span></button>`
  attachIconFallbacks($('#detail-body'))
  $('#detail-edit-formula').addEventListener('click', openFormula)
  openDrawer('detail-drawer')
}
function exportCSV() {
  const heading = [
    '总榜排名',
    '技能 / 英雄模型',
    '英文名',
    '所属英雄',
    '类型',
    '胜率',
    '平均选位',
    '选取频率',
    'GGXGG选位',
    '数据版本',
    '数据日期',
  ]
  const csvValue = (value) => {
    let text = String(value ?? '')
    if (/^[=+@\t\r]/.test(text)) text = `'${text}`
    return `"${text.replace(/"/g, '""')}"`
  }
  const lines = state.filtered.map((row) => [
    row.rank,
    row.displayName,
    row.englishName,
    row.heroDisplayName,
    entryType(row),
    percentage(row.winrate),
    decimal(row.pickRate, 6),
    percentage(row.draftFrequency),
    decimal(row.priority, 6),
    state.data.meta.patch,
    state.data.meta.dataAsOf,
  ])
  const csv =
    '\uFEFF' + [heading, ...lines].map((values) => values.map(csvValue).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `GGXGG${state.type === 'all' ? '征召总榜' : `${entryLabel()}筛选`}_${state.data.meta.patch || 'snapshot'}_${state.data.meta.dataAsOf || 'data'}.csv`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  toast(`已导出当前筛选的 ${state.filtered.length} 项，保留总榜排名。`)
}
function bindEvents() {
  window.addEventListener('hashchange', () => {
    if (state.data)
      setType(
        location.hash === '#heroes' ? 'heroes' : location.hash === '#skills' ? 'skills' : 'all',
      )
  })
  $('#open-formula').addEventListener('click', openFormula)
  $('#open-method').addEventListener('click', () => {
    openFormula()
    $('.variable-guide').open = true
  })
  $$('.close-drawer').forEach((button) => button.addEventListener('click', closeDrawer))
  $('#drawer-overlay').addEventListener('click', closeDrawer)
  $('#load-more').addEventListener('click', () => {
    const firstNewIndex = state.visible
    state.visible += PAGE_SIZE
    render()
    $$('.ability-row')[firstNewIndex]?.focus({ preventScroll: true })
  })
  $('#search').addEventListener('input', (event) => {
    state.query = event.target.value
    state.visible = PAGE_SIZE
    if (state.data) render()
  })
  $('#hero-filter').addEventListener('change', (event) => {
    state.hero = event.target.value
    state.visible = PAGE_SIZE
    if (state.data) render()
  })
  $('#clear-filters').addEventListener('click', clearFilters)
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      if (state.data) setType(tab.dataset.type)
    })
    tab.addEventListener('keydown', (event) => {
      const tabs = $$('.tab')
      let next = tabs.indexOf(tab)
      if (event.key === 'ArrowRight') next = (next + 1) % tabs.length
      else if (event.key === 'ArrowLeft') next = (next - 1 + tabs.length) % tabs.length
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = tabs.length - 1
      else return
      event.preventDefault()
      tabs[next].focus()
      if (state.data) setType(tabs[next].dataset.type)
    })
  })
  $$('.sort-button').forEach((button) =>
    button.addEventListener('click', () => {
      if (!state.data) return
      if (state.sort === button.dataset.sort)
        state.direction = state.direction === 'asc' ? 'desc' : 'asc'
      else {
        state.sort = button.dataset.sort
        state.direction =
          state.sort === 'winrate' || state.sort === 'draftFrequency' ? 'desc' : 'asc'
      }
      state.visible = PAGE_SIZE
      render()
    }),
  )
  $('#ranking-body').addEventListener('click', (event) => {
    const row = event.target.closest('.ability-row')
    if (row) openDetail(row.dataset.name)
  })
  $('#ranking-body').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const row = event.target.closest('.ability-row')
    if (row) {
      event.preventDefault()
      openDetail(row.dataset.name)
    }
  })
  $('#preview-formula').addEventListener('click', previewFormula)
  $('#formula-form').addEventListener('input', () => {
    $('#apply-formula').disabled = false
    $('#formula-preview').hidden = true
    $('#formula-feedback').textContent = ''
    $('#formula-feedback').classList.remove('error')
  })
  $('#reset-formula').addEventListener('click', () => {
    fillForm(state.engine.DEFAULT_ABILITY_PRIORITY)
    previewFormula()
    $('#formula-feedback').textContent = '已填入 GGXGG 默认规则，点击“应用到榜单”后生效。'
  })
  $('#formula-form').addEventListener('submit', (event) => {
    event.preventDefault()
    const preview = previewFormula()
    if (!preview) return
    state.sort = 'priority'
    state.direction = 'asc'
    state.visible = PAGE_SIZE
    applyCalculation(preview.config, preview.result)
    let persisted = true
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preview.config))
    } catch {
      persisted = false
    }
    closeDrawer()
    toast(
      persisted
        ? '规则已保存，全部技能与英雄模型已统一重算排名。'
        : '总榜已重新计算；浏览器不允许保存规则，刷新后将恢复默认。',
    )
  })
  $('#export-csv').addEventListener('click', exportCSV)
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.activeDrawer) {
      event.preventDefault()
      closeDrawer()
      return
    }
    if (
      event.key === '/' &&
      !state.activeDrawer &&
      !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)
    ) {
      event.preventDefault()
      $('#search').focus()
      return
    }
    if (event.key === 'Tab' && state.activeDrawer) {
      const focusable = $$(
        'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex="0"]',
        $(`#${state.activeDrawer}`),
      ).filter((element) => element.getClientRects().length > 0)
      const first = focusable[0]
      const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
  })
}
async function initialize() {
  try {
    const [engine, response] = await Promise.all([
      import('./data/formula-engine.js'),
      fetch('./data/ranking.json'),
    ])
    if (!response.ok) throw new Error(`数据文件读取失败（${response.status}）。`)
    const data = await response.json()
    if (
      !Array.isArray(data.abilities) ||
      !data.abilities.length ||
      !Array.isArray(data.heroes) ||
      !data.heroes.length ||
      !Array.isArray(data.population)
    )
      throw new Error('数据快照格式不完整。')
    state.engine = engine
    state.data = data
    let config = { ...engine.DEFAULT_ABILITY_PRIORITY }
    let invalidSaved = false
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) config = engine.validateAbilityPrioritySettings(JSON.parse(saved))
      calculate(config)
    } catch {
      config = { ...engine.DEFAULT_ABILITY_PRIORITY }
      invalidSaved = true
    }
    state.type =
      location.hash === '#heroes' ? 'heroes' : location.hash === '#skills' ? 'skills' : 'all'
    setMetadata()
    applyCalculation(config)
    setType(state.type)
    if (invalidSaved) toast('已恢复 GGXGG 默认规则，原先保存的规则无法使用。')
  } catch (error) {
    state.data = null
    $('#table-scroll').setAttribute('aria-busy', 'false')
    $('#ranking-body').innerHTML =
      `<tr class="state-row"><td colspan="7"><strong>榜单暂时未能载入</strong>${escapeHTML(error.message)}<br /><button id="retry-load" class="text-button">重新读取数据 →</button></td></tr>`
    $('#table-status').textContent = '数据读取失败'
    $('#snapshot-label').textContent = '快照暂不可用'
    $('#retry-load').addEventListener('click', () => {
      $('#ranking-body').innerHTML =
        '<tr class="state-row"><td colspan="7"><span class="loader"></span>正在重新读取…</td></tr>'
      $('#table-scroll').setAttribute('aria-busy', 'true')
      initialize()
    })
  }
}
bindEvents()
initialize()
