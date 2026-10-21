// Frozen, explicit fact/quote annotations; not an unrestricted semantic judge.
export function scoreAnswers(scene, records, output) {
  if (!output || !Array.isArray(output.answers) || output.answers.length !== scene.questions.length) throw Error('answer schema')
  const ids = output.answers.map(a => a.id)
  if (new Set(ids).size !== ids.length || ids.some(id => !scene.questions.some(q => q.id === id))) throw Error('duplicate or unknown answer schema')
  const rows = scene.questions.map(q => {
    const a = output.answers.find(a => a.id === q.id)
    if (!a || !Array.isArray(a.citations) || !(a.value === null || typeof a.value === 'string')) throw Error('answer schema')
    const correct = q.values.includes(a.value), required = Array.isArray(q.support) ? q.support : [q.support]
    const supported = correct && (a.value === null ? a.citations.length === 0 : a.citations.some(c => {
      const record = records.find(r => r.id === c.recordId)
      return record && typeof c.quote === 'string' && c.quote.length > 0 && record.text.includes(c.quote) && required.every(part => c.quote.includes(part))
    }))
    return { questionId: q.id, value: a.value, correct, supported, abstained: a.value === null }
  })
  return { total: rows.length, correct: rows.filter(r => r.correct).length, supported: rows.filter(r => r.supported).length, abstained: rows.filter(r => r.abstained).length, rows }
}
