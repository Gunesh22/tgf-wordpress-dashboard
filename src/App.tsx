import { useState, useEffect } from 'react'
import './App.css'

interface Connection {
  id: string
  name: string
  url: string
  apiKey: string
  status: 'checking' | 'connected' | 'error' | 'disconnected'
  errorMsg?: string
}

interface SiteField {
  key: string
  label: string
  value: any
  type: 'text' | 'boolean' | 'select'
  options?: string[]
}

interface SitePlugin {
  name: string
  version: string
}

interface PostType {
  slug: string
  label: string
}

interface SiteInfo {
  site_name: string
  wp_version: string
  php_version: string
  post_types: PostType[]
  fields: SiteField[]
  plugins: SitePlugin[]
  connected_at: string
}

interface WPPost {
  id: number
  title: string
  slug: string
  status: string
  date: string
  author: string
  content: string
  fields: Record<string, any>
}

interface ApiLog {
  id: string
  time: string
  method: string
  url: string
  status: number | string
  type: 'success' | 'error'
}

interface ExtractedField {
  id: string
  type: 'link' | 'image' | 'video' | 'price' | 'date' | 'general_text' | 'button'
  label: string
  value?: string
  buttonText?: string
  buttonUrl?: string
  originalPattern: string
}

interface ContentToken {
  type: 'static' | 'field'
  text?: string
  fieldId?: string
}

interface MatchInfo {
  start: number
  end: number
  type: 'link' | 'image' | 'video' | 'price' | 'date' | 'general_text' | 'button'
  label: string
  value?: string
  buttonText?: string
  buttonUrl?: string
  originalPattern: string
}

function parseContent(content: string): { tokens: ContentToken[]; fields: ExtractedField[] } {
  const tokens: ContentToken[] = []
  const fields: ExtractedField[] = []
  if (!content) return { tokens, fields }

  const matches: MatchInfo[] = []
  let match: RegExpExecArray | null

  // 1. Extract anchors/buttons
  const anchorRegex = /<a\s+([^>]*?)>([\s\S]*?)<\/a>/gi
  while ((match = anchorRegex.exec(content)) !== null) {
    const fullText = match[0]
    const attrs = match[1]
    const text = match[2]
    const hrefMatch = /href=["']([^"']*)["']/i.exec(attrs)
    const href = hrefMatch ? hrefMatch[1] : ''
    
    const newAttrs = attrs.replace(/href=["']([^"']*)["']/i, 'href="{{URL}}"')
    const originalPattern = `<a ${newAttrs}>{{TEXT}}</a>`
    
    matches.push({
      start: match.index,
      end: match.index + fullText.length,
      type: 'button',
      label: 'Button',
      buttonText: text.replace(/<[^>]*>/g, '').trim() || 'Button',
      buttonUrl: href,
      originalPattern
    })
  }

  // 2. Skip image extraction as per user request (dont show image instances)

  // 3. Extract videos (iframes)
  const iframeRegex = /<iframe\s+([^>]*?)>([\s\S]*?)<\/iframe>/gi
  while ((match = iframeRegex.exec(content)) !== null) {
    const fullText = match[0]
    const attrs = match[1]
    const inner = match[2]
    const srcMatch = /src=["']([^"']*)["']/i.exec(attrs)
    const src = srcMatch ? srcMatch[1] : ''
    
    const newAttrs = attrs.replace(/src=["']([^"']*)["']/i, 'src="{{VALUE}}"')
    const originalPattern = `<iframe ${newAttrs}>${inner}</iframe>`
    
    matches.push({
      start: match.index,
      end: match.index + fullText.length,
      type: 'video',
      label: 'Video',
      value: src,
      originalPattern
    })
  }

  // 4. Extract custom key-value text blocks
  const textBlockLabels = [
    'Workshop Date', 'Workshop Price', 'CTA Links', 'Videos', 'Images',
    'Date', 'Price', 'Schedule', 'Location', 'Venue', 'Time'
  ]
  
  textBlockLabels.forEach(label => {
    // Newline format
    const newlineRegex = new RegExp(`(${label})\\s*([\\r\\n]+)\\s*([^<\\r\\n]+)`, 'gi')
    let textMatch: RegExpExecArray | null
    while ((textMatch = newlineRegex.exec(content)) !== null) {
      const fullText = textMatch[0]
      const labelText = textMatch[1]
      const spacing = textMatch[2]
      const val = textMatch[3].trim()
      
      matches.push({
        start: textMatch.index,
        end: textMatch.index + fullText.length,
        type: label.toLowerCase().includes('price') || val.includes('₹') || val.includes('$') ? 'price' : 'date',
        label: labelText,
        value: val,
        originalPattern: `${labelText}${spacing}{{VALUE}}`
      })
    }

    // Colon format
    const colonRegex = new RegExp(`(${label})\\s*:\\s*([^<\\r\\n]+)`, 'gi')
    while ((textMatch = colonRegex.exec(content)) !== null) {
      const fullText = textMatch[0]
      const labelText = textMatch[1]
      const val = textMatch[2].trim()
      
      matches.push({
        start: textMatch.index,
        end: textMatch.index + fullText.length,
        type: label.toLowerCase().includes('price') || val.includes('₹') || val.includes('$') ? 'price' : 'date',
        label: labelText,
        value: val,
        originalPattern: `${labelText} : {{VALUE}}`
      })
    }
  })

  // Sort and remove overlaps
  matches.sort((a, b) => a.start - b.start)
  const nonOverlapping: MatchInfo[] = []
  let lastEnd = 0
  matches.forEach(m => {
    if (m.start >= lastEnd) {
      nonOverlapping.push(m)
      lastEnd = m.end
    }
  })

  // Re-build tokens and field IDs
  let currentPos = 0
  let idCounter = 0
  const labelCounts: Record<string, number> = {}

  nonOverlapping.forEach(m => {
    if (m.start > currentPos) {
      tokens.push({
        type: 'static',
        text: content.substring(currentPos, m.start)
      })
    }

    const baseLabel = m.label
    labelCounts[baseLabel] = (labelCounts[baseLabel] || 0) + 1
    const finalLabel = `${baseLabel} (Instance ${labelCounts[baseLabel]})`
    const fieldId = `ext-field-${++idCounter}`

    fields.push({
      id: fieldId,
      type: m.type,
      label: finalLabel,
      value: m.value,
      buttonText: m.buttonText,
      buttonUrl: m.buttonUrl,
      originalPattern: m.originalPattern
    })

    tokens.push({
      type: 'field',
      fieldId
    })

    currentPos = m.end
  })

  if (currentPos < content.length) {
    tokens.push({
      type: 'static',
      text: content.substring(currentPos)
    })
  }

  return { tokens, fields }
}

function rebuildContent(tokens: ContentToken[], fieldsList: ExtractedField[]): string {
  return tokens.map(token => {
    if (token.type === 'static') {
      return token.text || ''
    }
    const field = fieldsList.find(f => f.id === token.fieldId)
    if (!field) return ''
    
    if (field.type === 'button') {
      return field.originalPattern
        .replace('{{URL}}', field.buttonUrl || '')
        .replace('{{TEXT}}', field.buttonText || '')
    }
    return field.originalPattern.replace('{{VALUE}}', field.value || '')
  }).join('')
}

function App() {
  // Connections state
  const [connections, setConnections] = useState<Connection[]>(() => {
    const saved = localStorage.getItem('wp_dashboard_connections')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch (e) {
        return []
      }
    }
    return []
  })
  
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(() => {
    return localStorage.getItem('wp_dashboard_active_connection') || null
  })

  // Tabs navigation
  const [activeTab, setActiveTab] = useState<'overview' | 'settings' | 'content'>('overview')

  // Selected site data
  const [siteInfo, setSiteInfo] = useState<SiteInfo | null>(null)
  const [loadingSiteInfo, setLoadingSiteInfo] = useState(false)
  const [siteInfoError, setSiteInfoError] = useState<string | null>(null)

  // Options settings edit state
  const [settingsForm, setSettingsForm] = useState<Record<string, any>>({})
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsSuccessMsg, setSettingsSuccessMsg] = useState<string | null>(null)

  // Posts state
  const [posts, setPosts] = useState<WPPost[]>([])
  const [selectedPostType, setSelectedPostType] = useState<string>('post')
  const [loadingPosts, setLoadingPosts] = useState(false)
  const [selectedPostId, setSelectedPostId] = useState<number | null>(null)
  
  // Post Editor state
  const [editingTitle, setEditingTitle] = useState('')
  const [editingContent, setEditingContent] = useState('')
  const [editingStatus, setEditingStatus] = useState('draft')
  const [editingMetaFields, setEditingMetaFields] = useState<Array<{ key: string; value: string }>>([])
  const [newMetaKey, setNewMetaKey] = useState('')
  const [newMetaValue, setNewMetaValue] = useState('')
  const [savingPost, setSavingPost] = useState(false)
  const [postSaveSuccess, setPostSaveSuccess] = useState<string | null>(null)

  // Search filter states
  const [settingsSearch, setSettingsSearch] = useState('')
  const [metaSearch, setMetaSearch] = useState('')
  const [siteSearchQuery, setSiteSearchQuery] = useState('')
  const [postSearchQuery, setPostSearchQuery] = useState('')
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all')
  const [appliedPostSearchQuery, setAppliedPostSearchQuery] = useState('')

  // Visual Content Field Editor State
  const [editorMode, setEditorMode] = useState<'easy' | 'code'>('easy')
  const [contentTokens, setContentTokens] = useState<ContentToken[]>([])
  const [extractedFields, setExtractedFields] = useState<ExtractedField[]>([])

  const handleExtractedFieldChange = (id: string, updatedField: Partial<ExtractedField>) => {
    setExtractedFields(prev => {
      const updated = prev.map(f => f.id === id ? { ...f, ...updatedField } : f)
      const newContent = rebuildContent(contentTokens, updated)
      setEditingContent(newContent)
      return updated
    })
  }

  // Toast notifications state
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; type: 'success' | 'error' | 'info' }>>([])

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 4500)
  }

  const [testingConnection, setTestingConnection] = useState(false)

  // API logs console
  const [logs, setLogs] = useState<ApiLog[]>([])
  
  // Connect site modal state
  const [showConnectModal, setShowConnectModal] = useState(false)
  const [newConnName, setNewConnName] = useState('')
  const [newConnUrl, setNewConnUrl] = useState('')
  const [newConnApiKey, setNewConnApiKey] = useState('')
  const [connModalError, setConnModalError] = useState<string | null>(null)

  // Save connections helper
  useEffect(() => {
    localStorage.setItem('wp_dashboard_connections', JSON.stringify(connections))
  }, [connections])

  useEffect(() => {
    if (activeConnectionId) {
      localStorage.setItem('wp_dashboard_active_connection', activeConnectionId)
    } else {
      localStorage.removeItem('wp_dashboard_active_connection')
    }
  }, [activeConnectionId])

  // Log API calls to the internal developer log console
  const addLog = (method: string, url: string, status: number | string, type: 'success' | 'error') => {
    const newLog: ApiLog = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      time: new Date().toLocaleTimeString(),
      method,
      url,
      status,
      type
    }
    setLogs((prev) => [newLog, ...prev].slice(0, 100))
  }

  // Active Connection helper
  const activeConnection = connections.find(c => c.id === activeConnectionId)

  // Fetch API handler
  const makeRequest = async (connection: Connection, endpoint: string, options: RequestInit = {}) => {
    const cleanUrl = connection.url.replace(/\/$/, '')
    const url = `${cleanUrl}/wp-json/wp-dashboard-connector/v1${endpoint}`
    
    const headers = {
      'Content-Type': 'application/json',
      'X-WP-Connector-Key': connection.apiKey,
      ...options.headers
    }

    try {
      const res = await fetch(url, { ...options, headers })
      addLog(options.method || 'GET', url, res.status, res.ok ? 'success' : 'error')
      if (!res.ok) {
        throw new Error(`Status ${res.status}: ${res.statusText}`)
      }
      return await res.json()
    } catch (err: any) {
      // Fallback for default permalinks (non-pretty urls)
      const fallbackUrl = `${cleanUrl}/index.php?rest_route=/wp-dashboard-connector/v1${endpoint}`
      try {
        const res = await fetch(fallbackUrl, { ...options, headers })
        addLog(options.method || 'GET', fallbackUrl, res.status, res.ok ? 'success' : 'error')
        if (!res.ok) {
          throw new Error(`Status ${res.status}: ${res.statusText}`)
        }
        return await res.json()
      } catch (fallbackErr: any) {
        addLog(options.method || 'GET', url, 'Failed (Network Error)', 'error')
        throw new Error(err.message || 'Connection failed')
      }
    }
  }

  // Test single connection status
  const checkConnectionStatus = async (conn: Connection): Promise<{ success: boolean; info?: SiteInfo; error?: string }> => {
    try {
      const data = await makeRequest(conn, '/site-info')
      return { success: true, info: data }
    } catch (err: any) {
      return { success: false, error: err.message || 'Verification failed' }
    }
  }

  // Load active site profile details
  const loadActiveSiteData = async () => {
    if (!activeConnection) return
    
    setLoadingSiteInfo(true)
    setSiteInfoError(null)
    
    // Update connection status in list to checking
    setConnections(prev => prev.map(c => c.id === activeConnection.id ? { ...c, status: 'checking' } : c))

    const result = await checkConnectionStatus(activeConnection)
    if (result.success && result.info) {
      setSiteInfo(result.info)
      setConnections(prev => prev.map(c => c.id === activeConnection.id ? { ...c, status: 'connected' } : c))
      
      // Initialize settings form values
      const initialFields: Record<string, any> = {}
      result.info.fields.forEach(f => {
        initialFields[f.key] = f.value
      })
      setSettingsForm(initialFields)
      showToast(`Synchronized with ${activeConnection.name}`, 'success')
    } else {
      setSiteInfo(null)
      setSiteInfoError(result.error || 'Could not fetch site details')
      setConnections(prev => prev.map(c => c.id === activeConnection.id ? { ...c, status: 'error', errorMsg: result.error } : c))
      showToast(`Sync failed: ${result.error || 'Connection error'}`, 'error')
    }
    setLoadingSiteInfo(false)
  }

  // Reload site details when switching connections
  useEffect(() => {
    if (activeConnection) {
      loadActiveSiteData()
      setSelectedPostId(null)
      setPosts([])
      setPostSearchQuery('')
      setAppliedPostSearchQuery('')
      setSelectedStatusFilter('all')
    } else {
      setSiteInfo(null)
    }
  }, [activeConnectionId])

  // Fetch posts when changing tab to content or changing post type
  const fetchPostsList = async (keepSelection = false) => {
    if (!activeConnection) return
    setLoadingPosts(true)
    if (!keepSelection) {
      setSelectedPostId(null)
    }
    
    try {
      const data = await makeRequest(activeConnection, `/posts?post_type=${selectedPostType}`)
      if (Array.isArray(data)) {
        setPosts(data)
      } else {
        setPosts([])
      }
    } catch (err: any) {
      setPosts([])
      addLog('GET', `/posts?post_type=${selectedPostType}`, 'Failed to parse list', 'error')
      showToast('Failed to fetch posts list.', 'error')
    } finally {
      setLoadingPosts(false)
    }
  }

  useEffect(() => {
    if (activeConnection && activeTab === 'content') {
      fetchPostsList()
    }
  }, [activeConnectionId, activeTab, selectedPostType])

  // Add new connection profile
  const handleAddConnection = async (e: React.FormEvent) => {
    e.preventDefault()
    setConnModalError(null)

    if (!newConnName.trim() || !newConnUrl.trim() || !newConnApiKey.trim()) {
      setConnModalError('All fields are required.')
      return
    }

    setTestingConnection(true)
    const testConn: Connection = {
      id: `conn-${Date.now()}`,
      name: newConnName.trim(),
      url: newConnUrl.trim(),
      apiKey: newConnApiKey.trim(),
      status: 'checking'
    }

    // Attempt to verify credentials
    const check = await checkConnectionStatus(testConn)
    if (check.success) {
      const updatedConn: Connection = { ...testConn, status: 'connected' }
      setConnections((prev) => [...prev, updatedConn])
      setActiveConnectionId(updatedConn.id)
      setShowConnectModal(false)
      showToast(`Connected to ${newConnName.trim()}!`, 'success')
      
      // Reset inputs
      setNewConnName('')
      setNewConnUrl('')
      setNewConnApiKey('')
    } else {
      setConnModalError(`Verification failed: ${check.error}. Please check the URL and API key.`)
      showToast('Connection failed. Check details.', 'error')
    }
    setTestingConnection(false)
  }

  // Delete connection profile
  const handleDeleteConnection = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const target = connections.find(c => c.id === id)
    const name = target ? target.name : 'WordPress site'
    if (confirm(`Are you sure you want to remove connection to "${name}"?`)) {
      setConnections(prev => prev.filter(c => c.id !== id))
      showToast(`Removed connection: ${name}`, 'info')
      if (activeConnectionId === id) {
        setActiveConnectionId(null)
        setSiteInfo(null)
      }
    }
  }

  // Save general options/settings
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeConnection) return

    setSavingSettings(true)
    setSettingsSuccessMsg(null)

    try {
      const response = await makeRequest(activeConnection, '/update-options', {
        method: 'POST',
        body: JSON.stringify(settingsForm)
      })

      if (response && response.success) {
        setSettingsSuccessMsg('WordPress site settings updated successfully!')
        showToast('Settings saved successfully!', 'success')
        // Reload site data to capture updated values
        loadActiveSiteData()
      } else {
        throw new Error('Update failed')
      }
    } catch (err: any) {
      showToast(`Error saving settings: ${err.message}`, 'error')
    } finally {
      setSavingSettings(false)
    }
  }

  // Handle post selection in editor pane
  const handleSelectPost = (post: WPPost) => {
    setSelectedPostId(post.id)
    setEditingTitle(post.title)
    setEditingContent(post.content)
    setEditingStatus(post.status)
    setPostSaveSuccess(null)
    setMetaSearch('')
    
    // Auto-extract structured fields from content
    const parsed = parseContent(post.content)
    setContentTokens(parsed.tokens)
    setExtractedFields(parsed.fields)
    
    // Map meta fields object to key-value array for the editor
    const metaArray = Object.entries(post.fields).map(([key, val]) => ({
      key,
      value: typeof val === 'object' ? JSON.stringify(val) : String(val)
    }))
    setEditingMetaFields(metaArray)
  }

  // Meta fields handlers
  const handleMetaFieldChange = (index: number, value: string) => {
    setEditingMetaFields(prev => prev.map((item, i) => i === index ? { ...item, value } : item))
  }

  const handleAddMetaField = () => {
    if (!newMetaKey.trim()) return
    // Check if key already exists
    if (editingMetaFields.some(f => f.key === newMetaKey.trim())) {
      showToast('Meta key already exists.', 'error')
      return
    }
    setEditingMetaFields(prev => [...prev, { key: newMetaKey.trim(), value: newMetaValue }])
    showToast(`Added meta field key: ${newMetaKey.trim()}`, 'info')
    setNewMetaKey('')
    setNewMetaValue('')
  }

  const handleRemoveMetaField = (index: number) => {
    const field = editingMetaFields[index]
    setEditingMetaFields(prev => prev.filter((_, i) => i !== index))
    showToast(`Removed field: ${field.key}`, 'info')
  }

  // Save post changes
  const handleSavePost = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeConnection || selectedPostId === null) return

    setSavingPost(true)
    setPostSaveSuccess(null)

    // Construct the fields object from editingMetaFields array
    const fieldsObj: Record<string, string> = {}
    editingMetaFields.forEach(f => {
      fieldsObj[f.key] = f.value
    })

    try {
      const response = await makeRequest(activeConnection, '/update-post', {
        method: 'POST',
        body: JSON.stringify({
          id: selectedPostId,
          title: editingTitle,
          content: editingContent,
          status: editingStatus,
          fields: fieldsObj
        })
      })

      if (response && response.success) {
        setPostSaveSuccess('Post and custom metadata updated successfully!')
        showToast('Post and custom fields saved!', 'success')
        // Refresh posts list, keeping active selection
        fetchPostsList(true)
      } else {
        throw new Error('Server update failed')
      }
    } catch (err: any) {
      showToast(`Error saving post: ${err.message}`, 'error')
    } finally {
      setSavingPost(false)
    }
  }

  return (
    <div className="app-container">
      {/* Sidebar - Connection Profiles */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">W</div>
          <div className="brand-text">
            <h1>WP Connector</h1>
            <p>Remote Site Control</p>
          </div>
        </div>

        <div className="sidebar-content">
          <div>
            <div className="section-header">
              <span className="section-title">WordPress Sites</span>
              <button 
                className="btn-icon-sm" 
                onClick={() => setShowConnectModal(true)}
                title="Add site connection"
                aria-label="Add site connection"
              >
                +
              </button>
            </div>

            {/* Sidebar Site Search Box */}
            <div className="sidebar-search" style={{ padding: '0 12px 12px 12px', display: 'flex', gap: '6px' }}>
              <input 
                type="text" 
                placeholder="Search connected sites..."
                value={siteSearchQuery}
                onChange={(e) => setSiteSearchQuery(e.target.value)}
                style={{ 
                  flex: 1, 
                  padding: '6px 10px', 
                  fontSize: '12.5px', 
                  borderRadius: '6px', 
                  border: '1px solid var(--border)', 
                  background: 'rgba(255,255,255,0.03)',
                  color: 'var(--text-primary)',
                  height: 'auto',
                  margin: 0
                }}
                aria-label="Search connected sites"
              />
              <button 
                type="button" 
                className="btn-primary" 
                style={{ padding: '6px 10px', borderRadius: '6px', fontSize: '12px' }}
                onClick={() => {
                  showToast(`Filtering by "${siteSearchQuery}"`, 'info')
                }}
              >
                Search
              </button>
            </div>

            <div className="site-profiles-list">
              {connections.filter(c => 
                c.name.toLowerCase().includes(siteSearchQuery.toLowerCase()) ||
                c.url.toLowerCase().includes(siteSearchQuery.toLowerCase())
              ).length === 0 ? (
                <div style={{ padding: '12px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
                  {connections.length === 0 ? 'No sites connected. Click "+" to connect.' : 'No matching sites found.'}
                </div>
              ) : (
                connections
                  .filter(c => 
                    c.name.toLowerCase().includes(siteSearchQuery.toLowerCase()) ||
                    c.url.toLowerCase().includes(siteSearchQuery.toLowerCase())
                  )
                  .map((conn) => (
                    <div 
                      key={conn.id}
                      className={`profile-card ${activeConnectionId === conn.id ? 'active' : ''}`}
                      onClick={() => setActiveConnectionId(conn.id)}
                    >
                    <div className="profile-card-header">
                      <span className="profile-name">{conn.name}</span>
                      <span className={`status-dot ${conn.status}`}></span>
                    </div>
                    <div className="profile-url">{conn.url}</div>
                    
                    <div className="profile-card-actions">
                      <button 
                        className="btn-delete"
                        onClick={(e) => handleDeleteConnection(conn.id, e)}
                        title="Delete profile"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="sidebar-footer">
          <span>v1.0.0 • Connected</span>
        </div>
      </aside>

      {/* Main Panel */}
      <main className="main-dashboard">
        {activeConnection ? (
          <>
            {/* Top Bar with site context and tab switching */}
            <div className="top-bar">
              <div className="active-site-info" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="active-site-title">{activeConnection.name}</span>
                <span className="active-site-url-badge">{activeConnection.url}</span>
                <a 
                  href={activeConnection.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="btn-secondary"
                  style={{ 
                    padding: '4px 8px', 
                    fontSize: '11px', 
                    textDecoration: 'none', 
                    display: 'inline-flex', 
                    alignItems: 'center', 
                    gap: '4px',
                    borderRadius: '4px',
                    height: '24px',
                    margin: 0
                  }}
                  title="Open live website in a new tab"
                >
                  🔗 View Site
                </a>
              </div>

              <div className="top-bar-actions">
                <div className="tabs-navigation">
                  <button 
                    className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
                    onClick={() => setActiveTab('overview')}
                  >
                    Overview
                  </button>
                  <button 
                    className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
                    onClick={() => setActiveTab('settings')}
                  >
                    Site Settings
                  </button>
                  <button 
                    className={`tab-btn ${activeTab === 'content' ? 'active' : ''}`}
                    onClick={() => setActiveTab('content')}
                  >
                    Content Editor
                  </button>
                </div>

                <button 
                  className="btn-secondary" 
                  onClick={loadActiveSiteData}
                  disabled={loadingSiteInfo}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  {loadingSiteInfo ? <span className="animate-spin" style={{ display: 'inline-block', width: '12px', height: '12px', border: '2px solid', borderTopColor: 'transparent', borderRadius: '50%' }}></span> : 'Sync'}
                </button>
              </div>
            </div>

            {/* Main view container */}
            <div className="dashboard-content-body">
              {loadingSiteInfo && !siteInfo ? (
                <div className="empty-state">
                  <div className="animate-spin" style={{ width: '40px', height: '40px', border: '4px solid var(--border)', borderTopColor: 'var(--primary)', borderRadius: '50%' }}></div>
                  <p>Fetching WordPress details...</p>
                </div>
              ) : siteInfoError ? (
                <div className="empty-state">
                  <span style={{ fontSize: '48px' }}>⚠️</span>
                  <h3>Connection Error</h3>
                  <p>{siteInfoError}</p>
                  <button className="btn-primary" onClick={loadActiveSiteData}>Retry Connection</button>
                </div>
              ) : siteInfo ? (
                <>
                  {/* TAB 1: OVERVIEW */}
                  {activeTab === 'overview' && (
                    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                      <div className="grid-overview">
                        <div className="stat-card">
                          <span className="stat-label">Site Name</span>
                          <span className="stat-value" style={{ fontSize: '20px' }}>{siteInfo.site_name}</span>
                          <span className="stat-desc">Central WordPress title</span>
                        </div>
                        <div className="stat-card">
                          <span className="stat-label">WordPress Version</span>
                          <span className="stat-value">{siteInfo.wp_version}</span>
                          <span className="stat-desc">Core Engine</span>
                        </div>
                        <div className="stat-card">
                          <span className="stat-label">PHP Version</span>
                          <span className="stat-value">{siteInfo.php_version}</span>
                          <span className="stat-desc">Server Environment</span>
                        </div>
                        <div className="stat-card">
                          <span className="stat-label">Last Connected</span>
                          <span className="stat-value" style={{ fontSize: '13px', fontFamily: 'var(--font-mono)', fontWeight: 'normal', marginTop: '6px' }}>
                            {new Date(siteInfo.connected_at).toLocaleString()}
                          </span>
                          <span className="stat-desc">Sync Timestamp</span>
                        </div>
                      </div>

                      <div style={{ marginTop: '10px' }}>
                        <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px', color: 'var(--text-primary)' }}>Active Plugins</h2>
                        {siteInfo.plugins && siteInfo.plugins.length > 0 ? (
                          <div className="active-plugins-grid">
                            {siteInfo.plugins.map((plugin, index) => (
                              <div key={index} className="plugin-card">
                                <span className="plugin-name">{plugin.name}</span>
                                <span className="plugin-version">v{plugin.version}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No active plugins reported.</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* TAB 2: SETTINGS (General options) */}
                  {activeTab === 'settings' && (
                    <div className="animate-fade-in" style={{ maxWidth: '680px' }}>
                      <div className="pane-right" style={{ height: 'auto', overflow: 'visible' }}>
                        <div className="pane-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span className="pane-title">General Options Settings</span>
                          <input 
                            type="text"
                            placeholder="🔍 Search settings..."
                            value={settingsSearch}
                            onChange={(e) => setSettingsSearch(e.target.value)}
                            style={{ width: '220px', padding: '6px 12px', fontSize: '12.5px', height: 'auto', margin: 0 }}
                            aria-label="Search settings fields"
                          />
                        </div>
                        <form onSubmit={handleSaveSettings}>
                          <div className="form-scrollable">
                            {settingsSuccessMsg && (
                              <div style={{ background: 'var(--success-glow)', border: '1px solid var(--success)', color: 'var(--success)', padding: '12px', borderRadius: '8px', marginBottom: '20px', fontSize: '13.5px' }}>
                                {settingsSuccessMsg}
                              </div>
                            )}

                            {siteInfo.fields
                              .filter(field => 
                                field.label.toLowerCase().includes(settingsSearch.toLowerCase()) ||
                                field.key.toLowerCase().includes(settingsSearch.toLowerCase())
                              )
                              .map((field) => (
                                <div key={field.key} className="form-group">
                                  <label htmlFor={`settings-${field.key}`}>{field.label}</label>
                                  
                                  {field.type === 'text' && (
                                    <input 
                                      id={`settings-${field.key}`}
                                      type="text" 
                                      value={settingsForm[field.key] ?? ''}
                                      onChange={(e) => setSettingsForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                                    />
                                  )}

                                  {field.type === 'boolean' && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                                      <input 
                                        id={`settings-${field.key}`}
                                        type="checkbox"
                                        checked={!!settingsForm[field.key]}
                                        onChange={(e) => setSettingsForm(prev => ({ ...prev, [field.key]: e.target.checked }))}
                                        style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                                      />
                                      <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Enable this option</span>
                                    </div>
                                  )}

                                  {field.type === 'select' && (
                                    <select 
                                      id={`settings-${field.key}`}
                                      value={settingsForm[field.key] ?? ''}
                                      onChange={(e) => setSettingsForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                                    >
                                      {field.options?.map((opt) => (
                                        <option key={opt} value={opt}>{opt}</option>
                                      ))}
                                    </select>
                                  )}
                                </div>
                              ))}
                            {siteInfo.fields.filter(field => 
                              field.label.toLowerCase().includes(settingsSearch.toLowerCase()) ||
                              field.key.toLowerCase().includes(settingsSearch.toLowerCase())
                            ).length === 0 && (
                              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                                No settings fields found matching "{settingsSearch}".
                              </div>
                            )}
                          </div>
                          
                          <div className="form-footer">
                            <button type="submit" className="btn-primary" disabled={savingSettings}>
                              {savingSettings ? 'Saving...' : 'Save Settings'}
                            </button>
                          </div>
                        </form>
                      </div>
                    </div>
                  )}

                  {/* TAB 3: CONTENT / POSTS EDITOR */}
                  {activeTab === 'content' && (
                    <div className="split-pane animate-fade-in">
                      {/* Left list pane */}
                      <div className="pane-left">
                        <div className="pane-header" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span className="pane-title" style={{ marginRight: 'auto' }}>Posts list</span>
                          <select 
                            value={selectedPostType} 
                            onChange={(e) => {
                              setSelectedPostType(e.target.value)
                              setPostSearchQuery('')
                              setAppliedPostSearchQuery('')
                              setSelectedStatusFilter('all')
                            }}
                            style={{ padding: '4px 6px', fontSize: '11px', width: '90px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg-card)' }}
                            aria-label="Select post type"
                          >
                            {siteInfo.post_types.map((type) => (
                              <option key={type.slug} value={type.slug}>{type.label}</option>
                            ))}
                          </select>
                          <select
                            value={selectedStatusFilter}
                            onChange={(e) => setSelectedStatusFilter(e.target.value)}
                            style={{ padding: '4px 6px', fontSize: '11px', width: '95px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg-card)' }}
                            aria-label="Filter post status"
                          >
                            <option value="all">All Status</option>
                            <option value="publish">Published</option>
                            <option value="draft">Draft</option>
                            <option value="pending">Pending</option>
                            <option value="private">Private</option>
                          </select>
                        </div>

                        {/* Post Search Bar */}
                        <div style={{ padding: '0 12px 12px 12px', borderBottom: '1px solid var(--border)' }}>
                          <form 
                            onSubmit={(e) => {
                              e.preventDefault()
                              setAppliedPostSearchQuery(postSearchQuery)
                            }}
                            style={{ display: 'flex', gap: '6px', width: '100%' }}
                          >
                            <input 
                              type="text" 
                              placeholder={`Search ${selectedPostType}s...`}
                              value={postSearchQuery}
                              onChange={(e) => setPostSearchQuery(e.target.value)}
                              style={{ 
                                flex: 1, 
                                padding: '6px 10px', 
                                fontSize: '12px', 
                                borderRadius: '6px', 
                                border: '1px solid var(--border)', 
                                background: 'rgba(255,255,255,0.02)',
                                color: 'var(--text-primary)',
                                height: '32px',
                                margin: 0
                              }}
                              aria-label="Search posts"
                            />
                            <button 
                              type="submit"
                              className="btn-primary"
                              style={{ 
                                padding: '0 12px', 
                                fontSize: '12px', 
                                height: '32px', 
                                margin: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: '6px'
                              }}
                            >
                              🔍 Search
                            </button>
                          </form>
                        </div>
                        
                        <div className="pane-list">
                          {loadingPosts ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px' }}>
                              {[1, 2, 3, 4].map(n => (
                                <div key={n} className="skeleton-card">
                                  <div className="skeleton skeleton-text" style={{ width: '80%', height: '14px', marginBottom: '8px' }}></div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div className="skeleton skeleton-meta" style={{ width: '30%', height: '10px' }}></div>
                                    <div className="skeleton skeleton-meta" style={{ width: '20%', height: '14px', borderRadius: '4px' }}></div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : posts.length === 0 ? (
                            <div style={{ padding: '24px', fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center' }}>
                              No posts found for this type.
                            </div>
                          ) : (() => {
                            const filteredPosts = posts.filter(post => {
                              if (selectedStatusFilter !== 'all' && post.status !== selectedStatusFilter) {
                                return false
                              }
                              if (appliedPostSearchQuery) {
                                const q = appliedPostSearchQuery.toLowerCase()
                                return (post.title || '').toLowerCase().includes(q) ||
                                       (post.author || '').toLowerCase().includes(q) ||
                                       (post.status || '').toLowerCase().includes(q)
                              }
                              return true
                            })

                            if (filteredPosts.length === 0) {
                              return (
                                <div style={{ padding: '24px', fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center' }}>
                                  <p style={{ margin: '0 0 10px 0' }}>No items match your filters.</p>
                                  <button 
                                    type="button"
                                    className="btn-secondary"
                                    onClick={() => {
                                      setPostSearchQuery('')
                                      setAppliedPostSearchQuery('')
                                      setSelectedStatusFilter('all')
                                    }}
                                    style={{ padding: '4px 10px', fontSize: '11px', width: 'auto', display: 'inline-block' }}
                                  >
                                    Reset Filters
                                  </button>
                                </div>
                              )
                            }

                            return filteredPosts.map((post) => (
                              <div 
                                key={post.id}
                                className={`pane-list-item ${selectedPostId === post.id ? 'active' : ''}`}
                                onClick={() => handleSelectPost(post)}
                              >
                                <div className="item-title">{post.title || '(No Title)'}</div>
                                <div className="item-meta">
                                  <span>{post.author}</span>
                                  <span className={`post-status-badge ${post.status}`}>{post.status}</span>
                                </div>
                              </div>
                            ))
                          })()}
                        </div>
                      </div>

                      {/* Right Editor pane */}
                      <div className="pane-right">
                        {selectedPostId !== null ? (
                          <form onSubmit={handleSavePost} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                            <div className="pane-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span className="pane-title">Edit Post ID: {selectedPostId}</span>
                                <span className={`post-status-badge ${editingStatus}`}>{editingStatus}</span>
                              </div>
                              <a 
                                href={`${activeConnection.url.replace(/\/$/, '')}/?p=${selectedPostId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn-secondary"
                                style={{ 
                                  padding: '4px 10px', 
                                  fontSize: '11px', 
                                  textDecoration: 'none', 
                                  display: 'inline-flex', 
                                  alignItems: 'center', 
                                  gap: '4px',
                                  borderRadius: '4px',
                                  margin: 0
                                }}
                                title="Open this post/page in a new tab"
                              >
                                👁️ View Page
                              </a>
                            </div>

                            <div className="form-scrollable">
                              {postSaveSuccess && (
                                <div style={{ background: 'var(--success-glow)', border: '1px solid var(--success)', color: 'var(--success)', padding: '10px', borderRadius: '6px', marginBottom: '16px', fontSize: '13px' }}>
                                  {postSaveSuccess}
                                </div>
                              )}

                              <div className="form-group">
                                <label htmlFor="edit-post-title">Post Title</label>
                                <input 
                                  id="edit-post-title"
                                  type="text" 
                                  value={editingTitle} 
                                  onChange={(e) => setEditingTitle(e.target.value)}
                                  required
                                />
                              </div>

                              <div className="form-group">
                                <label htmlFor="edit-post-status">Status</label>
                                <select 
                                  id="edit-post-status"
                                  value={editingStatus}
                                  onChange={(e) => setEditingStatus(e.target.value)}
                                >
                                  <option value="publish">Publish</option>
                                  <option value="draft">Draft</option>
                                  <option value="pending">Pending</option>
                                  <option value="private">Private</option>
                                </select>
                              </div>

                              <div className="form-group">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                  <label htmlFor="edit-post-content" style={{ margin: 0 }}>Content</label>
                                  <div className="tab-group" style={{ display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.03)', padding: '2px', borderRadius: '6px' }}>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditorMode('easy')
                                        const parsed = parseContent(editingContent)
                                        setContentTokens(parsed.tokens)
                                        setExtractedFields(parsed.fields)
                                      }}
                                      style={{
                                        padding: '4px 10px',
                                        fontSize: '11px',
                                        borderRadius: '4px',
                                        border: 'none',
                                        cursor: 'pointer',
                                        background: editorMode === 'easy' ? 'var(--primary)' : 'transparent',
                                        color: editorMode === 'easy' ? '#fff' : 'var(--text-secondary)',
                                        fontWeight: '500'
                                      }}
                                    >
                                      ✨ Visual Fields
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditorMode('code')}
                                      style={{
                                        padding: '4px 10px',
                                        fontSize: '11px',
                                        borderRadius: '4px',
                                        border: 'none',
                                        cursor: 'pointer',
                                        background: editorMode === 'code' ? 'var(--primary)' : 'transparent',
                                        color: editorMode === 'code' ? '#fff' : 'var(--text-secondary)',
                                        fontWeight: '500'
                                      }}
                                    >
                                      📄 HTML Code
                                    </button>
                                  </div>
                                </div>

                                {editorMode === 'easy' ? (
                                  <div className="visual-fields-editor" style={{
                                    background: 'rgba(255,255,255,0.01)',
                                    border: '1px solid var(--border)',
                                    borderRadius: '8px',
                                    padding: '16px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '14px'
                                  }}>
                                    {extractedFields.length === 0 ? (
                                      <div style={{ textAlign: 'center', padding: '16px', color: 'var(--text-muted)' }}>
                                        <p style={{ fontSize: '13px', margin: '0 0 6px 0' }}>No structured fields auto-detected in content.</p>
                                        <button 
                                          type="button" 
                                          className="btn-link" 
                                          style={{ fontSize: '12px', color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                                          onClick={() => setEditorMode('code')}
                                        >
                                          Edit in HTML Code Mode
                                        </button>
                                      </div>
                                    ) : (
                                      extractedFields.map((field) => (
                                        <div key={field.id} className="form-group" style={{ margin: 0 }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                                            <span style={{ fontSize: '14px' }}>
                                              {field.type === 'date' && '📅'}
                                              {field.type === 'price' && '🏷️'}
                                              {field.type === 'link' && '🔗'}
                                              {field.type === 'image' && '🖼️'}
                                              {field.type === 'video' && '🎥'}
                                              {field.type === 'button' && '👆'}
                                            </span>
                                            <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>
                                              {field.label}
                                            </span>
                                          </div>
                                          {field.type === 'button' ? (
                                            <div style={{ display: 'flex', gap: '10px' }}>
                                              <div style={{ flex: 1 }}>
                                                <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Button Text</span>
                                                <input
                                                  type="text"
                                                  value={field.buttonText || ''}
                                                  onChange={(e) => handleExtractedFieldChange(field.id, { buttonText: e.target.value })}
                                                  style={{
                                                    width: '100%',
                                                    padding: '8px 12px',
                                                    fontSize: '13px',
                                                    borderRadius: '6px',
                                                    border: '1px solid var(--border)',
                                                    background: 'rgba(255,255,255,0.02)',
                                                    color: 'var(--text-primary)'
                                                  }}
                                                  placeholder="Button Text"
                                                />
                                              </div>
                                              <div style={{ flex: 2 }}>
                                                <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Link URL</span>
                                                <input
                                                  type="text"
                                                  value={field.buttonUrl || ''}
                                                  onChange={(e) => handleExtractedFieldChange(field.id, { buttonUrl: e.target.value })}
                                                  style={{
                                                    width: '100%',
                                                    padding: '8px 12px',
                                                    fontSize: '13px',
                                                    borderRadius: '6px',
                                                    border: '1px solid var(--border)',
                                                    background: 'rgba(255,255,255,0.02)',
                                                    color: 'var(--text-primary)'
                                                  }}
                                                  placeholder="https://..."
                                                />
                                              </div>
                                            </div>
                                          ) : (
                                            <input
                                              type="text"
                                              value={field.value || ''}
                                              onChange={(e) => handleExtractedFieldChange(field.id, { value: e.target.value })}
                                              style={{
                                                width: '100%',
                                                padding: '8px 12px',
                                                fontSize: '13px',
                                                borderRadius: '6px',
                                                border: '1px solid var(--border)',
                                                background: 'rgba(255,255,255,0.02)',
                                                color: 'var(--text-primary)'
                                              }}
                                              placeholder={`Enter ${field.label.toLowerCase()}...`}
                                            />
                                          )}
                                        </div>
                                      ))
                                    )}
                                  </div>
                                ) : (
                                  <textarea 
                                    id="edit-post-content"
                                    value={editingContent} 
                                    onChange={(e) => setEditingContent(e.target.value)}
                                    style={{ minHeight: '220px', fontFamily: 'monospace', fontSize: '13px' }}
                                  />
                                )}
                              </div>

                              {/* Custom Metadata Field Manager */}
                              <div className="meta-fields-editor">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', gap: '8px' }}>
                                  <h3 style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', margin: 0 }}>Custom Fields (Post Metadata)</h3>
                                  <input 
                                    type="text"
                                    placeholder="🔍 Search meta..."
                                    value={metaSearch}
                                    onChange={(e) => setMetaSearch(e.target.value)}
                                    style={{ width: '160px', padding: '5px 10px', fontSize: '12px', height: 'auto', margin: 0 }}
                                    aria-label="Filter metadata keys"
                                  />
                                </div>
                                
                                {editingMetaFields.length === 0 ? (
                                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>No custom metadata fields yet.</p>
                                ) : (
                                  editingMetaFields
                                    .map((field, idx) => ({ ...field, originalIndex: idx }))
                                    .filter(f => 
                                      f.key.toLowerCase().includes(metaSearch.toLowerCase()) || 
                                      f.value.toLowerCase().includes(metaSearch.toLowerCase())
                                    )
                                    .map((field) => (
                                      <div key={field.originalIndex} className="meta-field-row">
                                        <input 
                                          type="text" 
                                          value={field.key} 
                                          readOnly 
                                          style={{ opacity: 0.7, background: 'rgba(255,255,255,0.02)', cursor: 'not-allowed', width: '40%' }}
                                          aria-label="Meta key"
                                        />
                                        <input 
                                          type="text" 
                                          value={field.value} 
                                          onChange={(e) => handleMetaFieldChange(field.originalIndex, e.target.value)}
                                          placeholder="Value"
                                          aria-label="Meta value"
                                        />
                                        <button 
                                          type="button" 
                                          className="btn-delete" 
                                          style={{ padding: '8px 12px' }}
                                          onClick={() => handleRemoveMetaField(field.originalIndex)}
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    ))
                                )}

                                {editingMetaFields.length > 0 && editingMetaFields.map((field, idx) => ({ ...field, originalIndex: idx })).filter(f => 
                                  f.key.toLowerCase().includes(metaSearch.toLowerCase()) || 
                                  f.value.toLowerCase().includes(metaSearch.toLowerCase())
                                ).length === 0 && (
                                  <div style={{ padding: '12px 0', color: 'var(--text-muted)', fontSize: '12px' }}>
                                    No custom fields match "{metaSearch}".
                                  </div>
                                )}

                                {/* Add new meta fields row */}
                                <div style={{ display: 'flex', gap: '12px', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border)', alignItems: 'center' }}>
                                  <input 
                                    type="text" 
                                    placeholder="new_meta_key" 
                                    value={newMetaKey} 
                                    onChange={(e) => setNewMetaKey(e.target.value)}
                                    style={{ width: '40%', fontSize: '12px' }}
                                    aria-label="New meta key"
                                  />
                                  <input 
                                    type="text" 
                                    placeholder="Value" 
                                    value={newMetaValue} 
                                    onChange={(e) => setNewMetaValue(e.target.value)}
                                    style={{ fontSize: '12px' }}
                                    aria-label="New meta value"
                                  />
                                  <button 
                                    type="button" 
                                    className="btn-secondary" 
                                    onClick={handleAddMetaField}
                                    style={{ padding: '6px 12px', fontSize: '12px' }}
                                  >
                                    Add Key
                                  </button>
                                </div>
                              </div>
                            </div>

                            <div className="form-footer">
                              <button type="submit" className="btn-primary" disabled={savingPost}>
                                {savingPost ? 'Saving...' : 'Save Post & Meta'}
                              </button>
                            </div>
                          </form>
                        ) : (
                          <div className="empty-state">
                            <span style={{ fontSize: '32px' }}>📝</span>
                            <p>Select a post from the list on the left to start editing.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <div className="welcome-hero">
              <span className="welcome-logo">🌐</span>
              <h2>WordPress Dashboard Dashboard</h2>
              <p>Connect your WordPress sites via the Central Dashboard Connector plugin to read, update options, manage posts, and customize metadata from a single interface.</p>
              <div style={{ marginTop: '12px', display: 'flex', gap: '12px', justifyContent: 'center' }}>
                <button className="btn-primary" onClick={() => setShowConnectModal(true)}>Connect a WordPress Site</button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Connect Modal Overlay */}
      {showConnectModal && (
        <div className="modal-overlay" onClick={() => setShowConnectModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Connect WordPress Site</span>
              <button className="btn-icon-sm" onClick={() => setShowConnectModal(false)} aria-label="Close modal">×</button>
            </div>
            <form onSubmit={handleAddConnection}>
              <div className="modal-body">
                {connModalError && (
                  <div style={{ background: 'var(--danger-glow)', border: '1px solid var(--danger)', color: 'var(--danger)', padding: '8px 12px', borderRadius: '6px', marginBottom: '16px', fontSize: '12px' }}>
                    {connModalError}
                  </div>
                )}
                
                <div className="form-group">
                  <label htmlFor="new-conn-name">Connection Name</label>
                  <input 
                    id="new-conn-name"
                    type="text" 
                    placeholder="e.g. Local Development Site" 
                    value={newConnName} 
                    onChange={(e) => setNewConnName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="new-conn-url">Site Base URL</label>
                  <input 
                    id="new-conn-url"
                    type="url" 
                    placeholder="e.g. http://localhost:8080/wordpress" 
                    value={newConnUrl} 
                    onChange={(e) => setNewConnUrl(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="new-conn-apikey">Connector API Key</label>
                  <input 
                    id="new-conn-apikey"
                    type="password" 
                    placeholder="wp_conn_..." 
                    value={newConnApiKey} 
                    onChange={(e) => setNewConnApiKey(e.target.value)}
                    required
                  />
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Copy this from the WordPress Dashboard Connector settings page in WP Admin.
                  </p>
                </div>
              </div>

              <div className="form-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowConnectModal(false)} disabled={testingConnection}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={testingConnection}>
                  {testingConnection ? 'Verifying...' : 'Verify & Connect'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast Notifications */}
      <div className="toasts-container">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast ${toast.type}`}>
            <span className="toast-icon">
              {toast.type === 'success' && '✓'}
              {toast.type === 'error' && '⚠️'}
              {toast.type === 'info' && 'ℹ️'}
            </span>
            <span className="toast-message">{toast.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default App
