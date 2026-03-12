import { createWorker } from 'tesseract.js'
import type { Worker } from 'tesseract.js'

let _worker: Worker | null = null

async function getWorker(): Promise<Worker> {
  if (!_worker) {
    _worker = await createWorker('eng')
  }
  return _worker
}

export async function extractText(imagePath: string): Promise<string> {
  const worker = await getWorker()
  const { data } = await worker.recognize(imagePath)
  return data.text.trim()
}

export async function terminateOcr(): Promise<void> {
  if (_worker) {
    await _worker.terminate()
    _worker = null
  }
}
