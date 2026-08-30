import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import '@mdxeditor/editor/style.css'
import '@md/editor-core/editor.css'
import './app.css'

createRoot(document.getElementById('root')).render(<App />)
