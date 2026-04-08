import { useEffect, useState } from 'react'

export function Navbar() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav className={`navbar ${scrolled ? 'scrolled' : ''}`}>
      <a href="/" className="navbar-logo">
        <img src="/ucsb-favicon.ico" alt="UCSB" className="navbar-logo-img" />
        <span className="navbar-logo-text">ACE</span>
      </a>
      <div className="navbar-links-center">
        <a href="#how-it-works" className="navbar-link">How It Works</a>
        <a href="#features" className="navbar-link">Features</a>
        <a href="#pipeline" className="navbar-link">Pipeline</a>
      </div>
      <div className="navbar-actions">
        <a href="/auth" className="navbar-link">Log In</a>
        <a href="/auth" className="navbar-cta">Get Started</a>
      </div>
    </nav>
  )
}
