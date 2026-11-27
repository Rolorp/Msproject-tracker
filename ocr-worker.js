export async function createOcrWorker(logger) {
  const { default: tesseract } = await import('./vendor/tesseract/tesseract.esm.min.js');
  return new Promise((resolve, reject) => {
    let failed = false;
    const fail = error => {
      failed = true;
      clearTimeout(timeout);
      reject(error);
    };
    const timeout = setTimeout(() => fail(new Error('La preparación del OCR tardó demasiado.')), 60000);
    tesseract.createWorker('eng', 1, {
      workerPath: new URL('./vendor/tesseract/worker.min.js', import.meta.url).href,
      corePath: new URL('./vendor/core/', import.meta.url).href,
      langPath: new URL('./vendor/lang/', import.meta.url).href,
      workerBlobURL: false,
      logger,
      errorHandler: fail
    }).then(worker => {
      clearTimeout(timeout);
      if (failed) worker.terminate();
      else resolve(worker);
    }, fail);
  });
}
