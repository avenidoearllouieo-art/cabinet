export async function fetchAllResults(client, endpoint, params = {}) {
  const results = []
  const visitedPages = new Set()
  let page = 1
  let count = 0

  while (!visitedPages.has(page)) {
    visitedPages.add(page)
    const response = await client.get(endpoint, { params: { ...params, page } })
    const data = response.data

    if (Array.isArray(data)) {
      results.push(...data)
      count = results.length
      break
    }

    const pageResults = Array.isArray(data?.results) ? data.results : []
    results.push(...pageResults)
    count = Number.isFinite(Number(data?.count)) ? Number(data.count) : results.length
    if (!data?.next) break

    const nextPage = Number(new URL(data.next, window.location.href).searchParams.get('page'))
    page = Number.isInteger(nextPage) && nextPage > page ? nextPage : page + 1
  }

  return { results, count }
}
