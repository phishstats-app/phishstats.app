'use strict';

const BASE_URL = 'https://api.phish.net/v5';

function createClient({ apiKey, fetchImpl = fetch, baseUrl = BASE_URL }) {
  async function get(path) {
    const separator = path.includes('?') ? '&' : '?';
    const url = `${baseUrl}${path}${separator}apikey=${apiKey}`;
    const res = await fetchImpl(url);
    if (!res.ok) {
      throw new Error(`Phish.net API request failed: ${res.status} ${path}`);
    }
    const json = await res.json();
    if (json.error) {
      throw new Error(`Phish.net API error: ${json.error_message}`);
    }
    return json.data;
  }

  return {
    getSongs: () => get('/songs.json'),
    getSetlistsByYear: (year) => get(`/setlists/showyear/${year}.json`),
    getSetlistsByTour: (tourId) => get(`/setlists/tourid/${tourId}.json`),
    getSetlistByShowdate: (showdate) => get(`/setlists/showdate/${showdate}.json`),
    // Shows, not setlists: includes dates that have not happened yet.
    getShowsByYear: (year) => get(`/shows/showyear/${year}.json`),
  };
}

module.exports = { createClient };
