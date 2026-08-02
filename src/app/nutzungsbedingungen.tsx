import { LegalDocumentScreen } from '@/components/legal/legal-document-screen';
import { legalDraftNotice, termsSections } from '@/legal/additional-content';

export default function TermsScreen() {
  return <LegalDocumentScreen notice={legalDraftNotice} sections={termsSections} title="Nutzungsbedingungen" />;
}
