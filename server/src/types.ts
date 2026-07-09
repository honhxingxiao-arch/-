export type KnowledgeBasePermission = 'private' | 'group' | 'public'

export type KnowledgeBaseStatus = 'processing' | 'completed' | 'failed'

export type KnowledgeBaseScope = 'mine' | 'public'

export type KnowledgeBaseCategory = 'textbook' | 'general'

export type KnowledgeBaseIconKey =
  | 'medical'
  | 'nursing'
  | 'pharmacy'
  | 'tcm'
  | 'education'
  | 'legal'
  | 'product'
  | 'research'

export type KnowledgeBaseCoverKey = 'cube'

export type KnowledgeBaseCoverType = 'default' | 'custom'

export interface KnowledgeBaseActivityLog {
  id: string
  type: 'import' | 'update' | 'reference' | 'parse'
  message: string
  createdAt: string
  agentName?: string
  agentId?: string
  agentAvatarId?: string
  actor?: string
}

export interface KnowledgeBaseItem {
  id: string
  name: string
  description: string
  permission: KnowledgeBasePermission
  status: KnowledgeBaseStatus
  scope: KnowledgeBaseScope
  category: KnowledgeBaseCategory
  isOfficial?: boolean
  publishedBy?: string
  iconKey: KnowledgeBaseIconKey
  coverType?: KnowledgeBaseCoverType
  coverKey?: KnowledgeBaseCoverKey
  coverFileId?: string
  tags: string[]
  storageBytes: number
  documentCount: number
  referenceCount: number
  createdAt: string
  updatedAt: string
  failedAt?: string
  processingUpdatedAt?: string
  failedDocumentCount?: number
  processDone?: number
  processTotal?: number
  importMethod?: 'local' | 'web' | 'mixed'
  importSources?: KnowledgeBaseImportSource[]
  documents?: KnowledgeBaseDocument[]
  advancedConfig?: KnowledgeBaseImportAdvancedConfig
  recallConfig?: KnowledgeBaseRecallConfig
  permissionConfig?: KnowledgeBasePermissionConfig
  activityLogs?: KnowledgeBaseActivityLog[]
  recallRecords?: KnowledgeRecallRecord[]
}

export interface KnowledgeBaseRecycleItem {
  id: string
  knowledgeBaseId: string
  name: string
  deletedAt: string
  deletedBy: string
  originalPermission: KnowledgeBasePermission
  documentCount: number
  remainingDays: number
  snapshot: KnowledgeBaseItem
}

export interface KnowledgeBaseDocumentRecycleItem {
  id: string
  documentId: string
  knowledgeBaseId: string
  knowledgeBaseName: string
  documentName: string
  type: 'local' | 'web'
  format?: string
  sizeBytes: number
  deletedAt: string
  deletedBy: string
  remainingDays: number
  snapshot: KnowledgeBaseDocument
  importSourceSnapshot?: KnowledgeBaseImportSource
}

export interface KnowledgeBaseStats {
  mineCount: number
  publicCount: number
  totalDocuments: number
  totalReferences: number
  pendingCount: number
  recycleCount: number
}

export type KnowledgeRecallSearchMethod = 'semantic' | 'keyword' | 'hybrid'

export interface KnowledgeRecallChunk {
  id: string
  documentId: string
  fragmentId: string
  documentName: string
  content: string
  score: number
  index?: number
  charCount?: number
}

export interface KnowledgeRecallRecordChunk {
  id: string
  documentId: string
  fragmentId: string
  documentName: string
  score: number
}

export interface KnowledgeRecallRecord {
  id: string
  knowledgeBaseId: string
  query: string
  topK: number
  minScore: number
  minScoreEnabled: boolean
  searchMethod: KnowledgeRecallSearchMethod
  source: 'test' | 'app'
  durationMs: number
  chunkCount: number
  candidateTotal: number
  createdAt: string
  chunks: KnowledgeRecallRecordChunk[]
}

export interface KnowledgeRecallRunResult {
  query: string
  durationMs: number
  candidateTotal: number
  chunks: KnowledgeRecallChunk[]
  searchMethod: KnowledgeRecallSearchMethod
  minScoreEnabled: boolean
  minScore: number
  topK: number
}

export interface CreateKnowledgeBaseBody {
  name: string
  description?: string
  category?: KnowledgeBaseCategory
  permission?: KnowledgeBasePermission
  tags?: string[]
  documentCount?: number
  storageBytes?: number
  status?: KnowledgeBaseStatus
  processDone?: number
  processTotal?: number
  publishedBy?: string
  importMethod?: 'local' | 'web' | 'mixed'
  sources?: KnowledgeBaseImportSource[]
  advancedConfig?: KnowledgeBaseImportAdvancedConfig
  recallConfig?: KnowledgeBaseRecallConfig
  permissionConfig?: KnowledgeBasePermissionConfig
  coverType?: KnowledgeBaseCoverType
  coverKey?: KnowledgeBaseCoverKey
  coverFileId?: string
}

export interface UpdateKnowledgeBaseBody {
  name?: string
  description?: string
  category?: KnowledgeBaseCategory
  permission?: KnowledgeBasePermission
  tags?: string[]
  advancedConfig?: KnowledgeBaseImportAdvancedConfig
  recallConfig?: KnowledgeBaseRecallConfig
  permissionConfig?: KnowledgeBasePermissionConfig
  coverType?: KnowledgeBaseCoverType
  coverKey?: KnowledgeBaseCoverKey
  coverFileId?: string
}

export interface KnowledgeBaseImportSource {
  type: 'local' | 'web'
  name: string
  fileId?: string
  url?: string
  sizeBytes: number
  contentSummary?: string
  /** 网页导入：用户确认的正文区块 ID */
  sectionIds?: string[]
}

export type KnowledgeBaseDocumentStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface KnowledgeBaseDocumentFragment {
  id: string
  content: string
  score?: number
  index?: number
  charCount?: number
  hasImage?: boolean
  referenceCount?: number
}

export interface KnowledgeBaseDocument {
  id: string
  knowledgeBaseId: string
  name: string
  type: 'local' | 'web'
  format?: string
  fileId?: string
  url?: string
  sizeBytes: number
  status: KnowledgeBaseDocumentStatus
  fragmentCount?: number
  failReason?: string
  contentSummary?: string
  sectionIds?: string[]
  excerpt?: string
  fragments?: KnowledgeBaseDocumentFragment[]
  createdAt: string
  updatedAt: string
}

export interface KnowledgeBaseImportAdvancedConfig {
  parseMode: 'smart' | 'chapter' | 'fixed'
  chunkPreset: 'short' | 'standard' | 'long'
  sliceLength: number
  overlapLength: number
  chapterHeadingLevel: string
  chapterKeepTitles: boolean
  chapterSplitLong: boolean
  chapterMaxLength: number
  chapterMergeShort: boolean
  chapterMergeThreshold: number
  dedupe: boolean
  tableStructure: boolean
  keepImageCaptions: boolean
  enableOcr: boolean
  retryCount: number
  completionAction: 'detail' | 'list'
}

export interface KnowledgeBasePermissionConfig {
  groupIds?: string[]
  tagIds?: string[]
  studentIds?: string[]
}

export interface KnowledgeBaseRecallConfig {
  topK: number
  minScore: number
  minScoreEnabled: boolean
}

export interface UploadedImportFileRecord {
  id: string
  originalName: string
  mimeType: string
  sizeBytes: number
  storedPath: string
  uploadedAt: string
}

export type WebImportPageStatus = 'importable' | 'need_confirm' | 'blocked'

export type WebImportContentSectionKind = 'main' | 'nav' | 'footer' | 'sidebar' | 'unknown'

export type WebImportConfirmReason = 'too_short' | 'too_long' | 'mixed_noise'

export interface WebImportContentSectionDto {
  id: string
  title: string
  preview: string
  wordCount: number
  kind: WebImportContentSectionKind
  selected?: boolean
}

export interface WebImportPageDto {
  id: string
  title: string
  url: string
  status: WebImportPageStatus
  description: string
  wordCount?: number
  tableCount?: number
  imageCaptionCount?: number
  selected?: boolean
  source?: string
  excerpt?: string
  sections?: WebImportContentSectionDto[]
  confirmReason?: WebImportConfirmReason
  confirmedSectionIds?: string[]
}

export interface WebImportDiscoverRequest {
  url: string
  config: {
    scope: 'current' | 'subdomain' | 'sitemap'
    maxPages?: number
    maxDepth?: number
    sitemapUrl?: string
  }
}

export interface WebImportDiscoverResponse {
  pages: WebImportPageDto[]
  meta: {
    scope: 'current' | 'subdomain' | 'sitemap'
    startUrl: string
    totalFound: number
    displayedCount: number
    truncated: boolean
    sitemapUrl?: string
    fetchMode: 'live' | 'partial'
  }
}

export type KnowledgeRecallEngine = 'vector' | 'tfidf'

export interface RecallRequestBody {
  query: string
  topK?: number
  minScore?: number
  minScoreEnabled?: boolean
  searchMethod?: KnowledgeRecallSearchMethod
  rerankEnabled?: boolean
  source?: 'test' | 'app'
}

export interface RecallBatchRequestBody {
  queries: string[]
  topK?: number
  minScore?: number
  minScoreEnabled?: boolean
  searchMethod?: KnowledgeRecallSearchMethod
  rerankEnabled?: boolean
}

export interface RecallCompareConfigBody {
  label?: string
  topK?: number
  minScore?: number
  minScoreEnabled?: boolean
  searchMethod?: KnowledgeRecallSearchMethod
  rerankEnabled?: boolean
}

export interface RecallCompareRequestBody {
  query: string
  configA: RecallCompareConfigBody
  configB: RecallCompareConfigBody
}

export interface AppStore {
  knowledgeBases: KnowledgeBaseItem[]
  recycleBin: KnowledgeBaseRecycleItem[]
  documentRecycleBin?: KnowledgeBaseDocumentRecycleItem[]
  uploadedFiles: UploadedImportFileRecord[]
}

export interface ApiSuccess<T> {
  code: 0
  data: T
  message?: string
}

export interface ApiError {
  code: number
  message: string
}
