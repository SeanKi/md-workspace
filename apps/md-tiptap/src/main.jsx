import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import '@md/editor-core/editor.css'
import '@md/editor-tiptap/tiptap.css'
import './app.css'
import './zoom.js'   // Ctrl+휠 확대·축소 (75% ~ 200%)

createRoot(document.getElementById('root')).render(<App />)
