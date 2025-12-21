// Configuration de l'URL de l'API
// En développement : http://localhost:3005
// En production : URL de votre backend déployé
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005'

export const apiClient = {
  get: async (endpoint: string) => {
    const response = await fetch(`${API_URL}${endpoint}`, {
      credentials: 'include',
    })
    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`)
    }
    return response.json()
  },
  
  post: async (endpoint: string, data: any) => {
    const response = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(data),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }))
      throw new Error(error.message || `API Error: ${response.statusText}`)
    }
    return response.json()
  },
}

export default apiClient

