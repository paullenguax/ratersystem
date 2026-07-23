// Matches the old system's posture (Storyline-Replacement/reference-files/Candidate.php):
// a simple online/offline dot, no real offline support. Confirmed with the
// stakeholder that a live connection is required for v1 — see spec §2/§3.
export function initOnlineStatusDot(el: HTMLElement) {
  function update() {
    el.style.backgroundColor = navigator.onLine ? '#2e7d32' : '#c62828'
    el.title = navigator.onLine ? 'Online' : 'Offline'
  }
  update()
  window.addEventListener('online', update)
  window.addEventListener('offline', update)

  window.addEventListener('beforeunload', event => {
    if (!navigator.onLine) {
      event.preventDefault()
      event.returnValue = 'The internet is not connected!'
    }
  })
}
