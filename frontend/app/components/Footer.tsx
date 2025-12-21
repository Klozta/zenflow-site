import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="bg-gray-900 text-white mt-auto">
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div>
            <h3 className="text-xl font-bold mb-4">ZenFlow</h3>
            <p className="text-gray-400">
              Votre plateforme e-commerce moderne et sécurisée.
            </p>
          </div>
          
          <div>
            <h4 className="font-semibold mb-4">Navigation</h4>
            <ul className="space-y-2 text-gray-400">
              <li><Link href="/" className="hover:text-white">Accueil</Link></li>
              <li><Link href="/products" className="hover:text-white">Produits</Link></li>
              <li><Link href="/cart" className="hover:text-white">Panier</Link></li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-semibold mb-4">Compte</h4>
            <ul className="space-y-2 text-gray-400">
              <li><Link href="/login" className="hover:text-white">Connexion</Link></li>
              <li><Link href="/register" className="hover:text-white">Inscription</Link></li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-semibold mb-4">Contact</h4>
            <p className="text-gray-400">
              Support disponible 24/7
            </p>
          </div>
        </div>
        
        <div className="border-t border-gray-800 mt-8 pt-8 text-center text-gray-400">
          <p>&copy; 2025 ZenFlow. Tous droits réservés.</p>
        </div>
      </div>
    </footer>
  )
}

