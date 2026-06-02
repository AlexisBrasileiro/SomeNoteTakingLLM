import { useState, useCallback, useEffect, type ChangeEvent, type KeyboardEvent } from 'react'
import { useSearch } from './SearchContext'

export function SearchBar() {
  const { searchAll, clearSearch } = useSearch()
  const [inputValue, setInputValue] = useState('')

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value
    setInputValue(query)
  }

  const handleSearch = useCallback(async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (!inputValue.trim()) {
        clearSearch()
        return
      }
      try {
        await searchAll(inputValue)
      } catch {
        clearSearch()
      }
    }
  }, [inputValue, searchAll, clearSearch])

  // Debounce logic for input changes
  useEffect(() => {
    const handler = setTimeout(() => {
      // We don't trigger search on every keystroke, only on Enter or after a short delay
    }, 500)

    return () => {
      clearTimeout(handler)
    }
  }, [inputValue])

  return (
    <div style={{ position: 'static', top: '100px', right: '20px', zIndex: 1000, background: '#1e293b', padding: '10px', borderRadius: '8px', boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)' }}>
      <input
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onKeyDown={handleSearch}
        placeholder="Pesquisar notas, projetos ou tags..."
        style={{ width: '100%', border: 'none', background: 'transparent', color: '#e2e8f0', outline: 'none' }}
      ></input>
      {/* Placeholder for autocomplete suggestions (to be implemented with actual data) */}
      {/* Autocomplete suggestions would be rendered here based on search results */}
    </div>
  )
}