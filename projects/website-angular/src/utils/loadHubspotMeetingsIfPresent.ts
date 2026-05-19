// HubSpot's Meetings embed runs when its script is loaded; it scans for
// `.meetings-iframe-container` elements and converts each into an iframe.
// We render the placeholder div in MDX and call this helper after the
// content lands in the DOM so the script kicks in. A fresh script tag is
// appended on each call so SPA navigations re-trigger processing of any
// newly-rendered containers.
const SCRIPT_SRC = 'https://static.hsappstatic.net/MeetingsEmbed/ex/MeetingsEmbedCode.js';

export default function loadHubspotMeetingsIfPresent(root: Element): void {
  if (typeof document === 'undefined') return;
  if (!root.querySelector('.meetings-iframe-container')) return;
  const script = document.createElement('script');
  script.src = SCRIPT_SRC;
  script.async = true;
  document.body.appendChild(script);
}
