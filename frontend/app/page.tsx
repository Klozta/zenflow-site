'use client'

import { useEffect, useState } from 'react'
import ProductCard from './components/ProductCard'

interface Product {
  id: string
  title: string
  description?: string
  price: number
  images?: string[]
  category?: string
}

export default function Home() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchProducts()
  }, [])

  const fetchProducts = async () => {
    try {
      setLoading(true)
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005'
      const response = await fetch(`${apiUrl}/api/products?limit=8`)
      
      if (!response.ok) {
        throw new Error('Erreur lors du chargement des produits')
      }
      
      const data = await response.json()
      setProducts(data.products || data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue')
      console.error('Erreur:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Hero Section */}
      <section className="text-center mb-12">
        <h1 className="text-5xl font-bold text-gray-900 mb-4">
          Bienvenue sur ZenFlow
        </h1>
        <p className="text-xl text-gray-600 mb-8">
          Découvrez notre sélection de produits de qualité
        </p>
      </section>

      {/* Products Section */}
      <section>
        <h2 className="text-3xl font-bold text-gray-900 mb-6">Produits populaires</h2>
        
        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-600">Chargement des produits...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
            <p>{error}</p>
            <p className="text-sm mt-2">Assurez-vous que le backend est démarré sur http://localhost:3005</p>
          </div>
        )}

        {!loading && !error && products.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-600 text-lg">Aucun produit disponible pour le moment.</p>
          </div>
        )}

        {!loading && !error && products.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
