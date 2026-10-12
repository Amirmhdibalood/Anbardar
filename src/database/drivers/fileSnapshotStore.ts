import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import type { SnapshotStore } from '../snapshot'

const DIR = 'snapshots'

/** Snapshotها در پوشه خصوصی برنامه (Directory.Data) نگهداری می‌شوند؛ از backup خودکار گوگل هم مستثنا است. */
export const fileSnapshotStore: SnapshotStore = {
  async save(name, content) {
    await Filesystem.writeFile({ path: `${DIR}/${name}`, data: content, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true })
  },
  async list() {
    try {
      const result = await Filesystem.readdir({ path: DIR, directory: Directory.Data })
      return result.files.map((f) => f.name).sort()
    } catch {
      return []
    }
  },
  async read(name) {
    try {
      const result = await Filesystem.readFile({ path: `${DIR}/${name}`, directory: Directory.Data, encoding: Encoding.UTF8 })
      return typeof result.data === 'string' ? result.data : null
    } catch {
      return null
    }
  },
  async remove(name) {
    await Filesystem.deleteFile({ path: `${DIR}/${name}`, directory: Directory.Data })
  },
}
