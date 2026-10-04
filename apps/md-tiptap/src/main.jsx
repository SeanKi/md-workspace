import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import '@md/editor-core/editor.css'
import '@md/editor-tiptap/tiptap.css'
import './app.css'

createRoot(document.getElementById('root')).render(<App />)
