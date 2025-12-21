'use client'

import Link from 'next/link'
import { useState } from 'react'

export default function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  return (
    <header className="bg-white shadow-md sticky top-0 z-50">
      <nav className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-2xl font-bold text-gray-900">
            ZenFlow
          </Link>
          
          <div className="hidden md:flex items-center space-x-6">
            <Link href="/" className="text-gray-700 hover:text-gray-900">
              Accueil
            </Link>
            <Link href="/products" className="text-gray-700 hover:text-gray-900">
              Produits
            </Link>
            <Link href="/cart" className="text-gray-700 hover:text-gray-900">
              Panier
            </Link>
            <Link href="/login" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
              Connexion
            </Link>
          </div>

          <button
            className="md:hidden"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>

        {isMenuOpen && (
          <div className="md:hidden mt-4 space-y-2">
            <Link href="/" className="block text-gray-700 hover:text-gray-900">Accueil</Link>
            <Link href="/products" className="block text-gray-700 hover:text-gray-900">Produits</Link>
            <Link href="/cart" className="block text-gray-700 hover:text-gray-900">Panier</Link>
            <Link href="/login" className="block bg-blue-600 text-white px-4 py-2 rounded">Connexion</Link>
          </div>
        )}
      </nav>
    </header>
  )
}

