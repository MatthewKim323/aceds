import { Navbar } from '../components/Navbar'
import { Hero } from '../components/Hero'
import { HowItWorks } from '../components/HowItWorks'
import { Features } from '../components/Features'
import { DataPipeline } from '../components/DataPipeline'
import { BuiltForUCSB } from '../components/BuiltForUCSB'
import { FooterCTA } from '../components/FooterCTA'

export function Landing() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <HowItWorks />
        <Features />
        <DataPipeline />
        <BuiltForUCSB />
      </main>
      <FooterCTA />
    </>
  )
}
