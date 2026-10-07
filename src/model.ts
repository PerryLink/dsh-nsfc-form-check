/**
 * Input contract for the NSFC proposal form and anonymity checker.
 *
 * The tool never receives the proposal as a *file to interpret semantically*: it
 * receives the text that a reviewer would read, the bibliographic metadata that
 * travels with the electronic document, and the institution's own roster of
 * identity terms (author names, institution names, advisor names). The roster is
 * the point: a check for "the applicant's name must not appear" is only
 * meaningful against a list of names, and that list belongs to the deployment,
 * not to a rule pack that ships to everyone.
 */

/** One line of text with its provenance, so a finding can point at it. */
export interface TextLine {
  /** 1-based line number within the extracted text. */
  line: number
  text: string
}

/** What the file itself carries that a reader may never see. */
export interface DocumentMetadata {
  /** Document title property. */
  title?: string
  /** Author property. This is a classic anonymity leak. */
  author?: string
  /** Company or organisation property. */
  company?: string
  /** Last-modified-by property. */
  lastModifiedBy?: string
}

/** The whole normalized input. */
export interface ProposalInput {
  target: string
  /** Extracted readable text, one entry per line. */
  lines: TextLine[]
  /** Metadata the electronic document carries. */
  metadata: DocumentMetadata
  /** File extension of the source, lower-cased without the dot. */
  sourceFormat: string
  warnings: string[]
}
