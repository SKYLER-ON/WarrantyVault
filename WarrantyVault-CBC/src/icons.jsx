// Small inline line-icon set (24px grid, stroke-based) so the design needs no extra dependency.
const paths = {
  shield: 'M12 3l8 3v6c0 4.5-3.2 8.2-8 9-4.8-.8-8-4.5-8-9V6l8-3z',
  'shield-check': 'M12 3l8 3v6c0 4.5-3.2 8.2-8 9-4.8-.8-8-4.5-8-9V6l8-3zM9 12l2 2 4-4',
  home: 'M3 11l9-8 9 8M5 10v10h14V10',
  box: 'M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8',
  clipboard: 'M9 4h6a1 1 0 011 1v1H8V5a1 1 0 011-1zM8 6H6a1 1 0 00-1 1v13a1 1 0 001 1h12a1 1 0 001-1V7a1 1 0 00-1-1h-2M9 14l2 2 4-4',
  wrench: 'M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z',
  history: 'M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8M3 3v5h5M12 7v5l4 2',
  pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0116 0zM12 13a3 3 0 100-6 3 3 0 000 6z',
  users: 'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
  bell: 'M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 003.4 0',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3',
  plus: 'M12 5v14M5 12h14',
  'arrow-right': 'M5 12h14M12 5l7 7-7 7',
  'arrow-up-right': 'M7 17L17 7M7 7h10v10',
  check: 'M20 6L9 17l-5-5',
  x: 'M18 6L6 18M6 6l12 12',
  alert: 'M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0zM12 9v4M12 17h.01',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  mail: 'M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zM22 7l-10 7L2 7',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  'eye-off': 'M9.9 4.2A10 10 0 0112 4c6.4 0 10 8 10 8a17 17 0 01-2.2 3.2M6.6 6.6A16.5 16.5 0 002 12s3.6 8 10 8a9.7 9.7 0 005.4-1.6M2 2l20 20M9.9 9.9a3 3 0 004.2 4.2',
  key: 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 11-7.8 7.8 5.5 5.5 0 017.8-7.8zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4',
  lock: 'M5 11h14a1 1 0 011 1v8a1 1 0 01-1 1H5a1 1 0 01-1-1v-8a1 1 0 011-1zM8 11V7a4 4 0 118 0v4',
  'log-out': 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  headphones: 'M3 14v-2a9 9 0 0118 0v2M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z',
  laptop: 'M4 5h16v11H4zM2 20h20',
  coffee: 'M17 8h1a4 4 0 010 8h-1M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4zM6 2v3M10 2v3M14 2v3',
  monitor: 'M2 4h20v13H2zM8 21h8M12 17v4',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  user: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z',
  'chevron-down': 'M6 9l6 6 6-6',
  help: 'M12 21a9 9 0 100-18 9 9 0 000 18zM9.1 9a3 3 0 015.8 1c0 2-3 3-3 3M12 17h.01',
  refresh: 'M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5',
  camera: 'M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2zM12 17a4 4 0 100-8 4 4 0 000 8z',
}

export const categoryIcon = (category = '') => {
  const c = category.toLowerCase()
  return c.includes('kitchen') ? 'coffee' : c.includes('home') ? 'home' : /electronic|mobile|laptop|tv|audio/.test(c) ? 'laptop' : 'box'
}

export default function Icon({ name, size = 18, strokeWidth = 1.8 }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name] || paths.box} />
    </svg>
  )
}
