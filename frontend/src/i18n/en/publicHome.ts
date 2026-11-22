// PORTAL-04 (#208): the public home page — English of ../ar/publicHome.ts (the same keys; the Arabic is the reference).
import type { publicHome as arPublicHome } from '../ar/publicHome'

export const publicHome: typeof arPublicHome = {
  hero: {
    titleNamed: 'Welcome to {{name}}',
    title: 'Welcome',
    subtitle: 'Structured learning programs with lessons you follow step by step, and progress you see in My School.',
    browse: 'Browse programs',
    signIn: 'Sign in',
    accountsNote: 'Accounts are created by the academy.',
    mySchool: 'My School',
    dashboard: 'Dashboard',
  },
  programs: {
    title: 'Learning programs',
    subtitle: 'From the academy’s published programs: their overview, content and fees.',
    all: 'All programs',
    empty: 'No program is published yet.',
    loadError: 'The programs could not be loaded.',
    retry: 'Try again',
    closedVisitor: {
      title: 'Programs are open to account holders',
      text: 'The academy does not show its programs to visitors. Sign in with your account to browse them.',
      action: 'Sign in',
    },
    closedLearner: {
      title: 'Browse the courses from your account',
      text: 'The academy does not show its programs to visitors; the courses open to you are on the courses page.',
      action: 'Courses page',
    },
    closedStaff: {
      title: 'Public browsing is off',
      text: 'Visitors see none of the academy’s programs because browsing courses as a visitor is not enabled in the settings.',
      action: 'Settings',
    },
  },
  steps: {
    title: 'How do you start?',
    choose: {
      title: 'Choose your program',
      text: 'Browse the programs and read each one’s overview, content and fees.',
    },
    signIn: {
      title: 'Sign in with your account',
      text: 'Accounts are created by the academy; sign in with the account it gives you.',
    },
    learn: {
      title: 'Enroll and start learning',
      text: 'Enroll in a class — at once for a free program, after payment and the academy’s approval for a paid one — then follow your lessons in My School.',
    },
  },
  cta: {
    visitorTitle: 'Ready to start?',
    visitorText: 'Choose the program that suits you, then sign in with your account to enroll.',
    learnerTitle: 'Continue learning',
    learnerText: 'Your lessons, progress and upcoming sessions in one place.',
  },
}
