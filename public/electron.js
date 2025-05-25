const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');
const fs = require('fs').promises;
const pdfParse = require('pdf-parse');
const XLSX = require('xlsx');
const OpenAI = require('openai');
const Store = require('electron-store');
const { Mistral } = require('@mistralai/mistralai');
const { responseFormatFromZodObject } = require('@mistralai/mistralai/extra/structChat');
const { PdfReader } = require('pdfreader');

// Initialize secure store
const store = new Store({
  encryptionKey: 'pdf-scanner-encryption-key',
  name: 'pdf-scanner-config'
});

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadURL(
    isDev
      ? 'http://localhost:3000'
      : `file://${path.join(__dirname, '../build/index.html')}`
  );

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // Remove the default menu
  Menu.setApplicationMenu(null);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC handlers
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.filePaths[0];
});

ipcMain.handle('select-file', async (event, filters = []) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: filters
  });
  return result.filePaths[0];
});

// New handler for creating/saving Excel log files
ipcMain.handle('save-excel-file', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: 'pdf-scan-log.xlsx',
    filters: [
      { name: 'Excel Files', extensions: ['xlsx'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  return result.filePath;
});

// Combined handler for Excel file selection (open existing or create new)
ipcMain.handle('select-excel-file', async () => {
  // First, ask user if they want to open existing or create new
  const choice = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Open Existing', 'Create New', 'Cancel'],
    defaultId: 1,
    title: 'Excel Log File',
    message: 'Would you like to open an existing Excel log file or create a new one?'
  });

  if (choice.response === 0) {
    // Open existing file
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Excel Files', extensions: ['xlsx', 'xls'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    return result.filePaths[0];
  } else if (choice.response === 1) {
    // Create new file
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: 'pdf-scan-log.xlsx',
      filters: [
        { name: 'Excel Files', extensions: ['xlsx'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    return result.filePath;
  }
  
  return null; // Cancel
});

// API Key storage handlers
ipcMain.handle('save-api-key', async (event, apiKey) => {
  try {
    store.set('openaiApiKey', apiKey);
    return true;
  } catch (error) {
    console.error('Failed to save API key:', error);
    return false;
  }
});

ipcMain.handle('load-api-key', async () => {
  try {
    return store.get('openaiApiKey', '');
  } catch (error) {
    console.error('Failed to load API key:', error);
    return '';
  }
});

// Mistral API Key storage handlers
ipcMain.handle('save-mistral-api-key', async (event, apiKey) => {
  try {
    store.set('mistralApiKey', apiKey);
    return true;
  } catch (error) {
    console.error('Failed to save Mistral API key:', error);
    return false;
  }
});

ipcMain.handle('load-mistral-api-key', async () => {
  try {
    return store.get('mistralApiKey', '');
  } catch (error) {
    console.error('Failed to load Mistral API key:', error);
    return '';
  }
});

// Folder paths storage handlers
ipcMain.handle('save-config', async (event, config) => {
  try {
    if (config.inputFolder) store.set('inputFolder', config.inputFolder);
    if (config.outputFolder) store.set('outputFolder', config.outputFolder);
    if (config.logFile) store.set('logFile', config.logFile);
    if (config.processingMethod !== undefined) store.set('processingMethod', config.processingMethod);
    return true;
  } catch (error) {
    console.error('Failed to save config:', error);
    return false;
  }
});

ipcMain.handle('load-config', async () => {
  try {
    return {
      inputFolder: store.get('inputFolder', ''),
      outputFolder: store.get('outputFolder', ''),
      logFile: store.get('logFile', ''),
      processingMethod: store.get('processingMethod', 'pdfreader')
    };
  } catch (error) {
    console.error('Failed to load config:', error);
    return {
      inputFolder: '',
      outputFolder: '',
      logFile: '',
      processingMethod: 'pdfreader'
    };
  }
});

const { z } = require('zod');

// Document Annotation response format
const DocumentSchema = z.object({
  date: z.string(),
  billed_amount: z.number(),
  currency: z.string(),
  invoice_number: z.string(),
  sender: z.string(),
  line_items: z.array(z.object({
    description: z.string(),
    quantity: z.number(),
    unit_price: z.number(),
    total_price: z.number()
  }))
});

ipcMain.handle('process-pdfs', async (event, config) => {
  const { inputFolder, outputFolder, logFile, apiKey, mistralApiKey, processingMethod } = config;
  
  try {
    const openai = new OpenAI({ apiKey });
    const results = [];
    
    // Get all PDF files
    const files = await fs.readdir(inputFolder);
    const pdfFiles = files.filter(file => file.toLowerCase().endsWith('.pdf'));
    
    // Send initial progress
    event.sender.send('processing-progress', {
      type: 'start',
      totalFiles: pdfFiles.length,
      currentFile: 0,
      message: `Starting processing of ${pdfFiles.length} PDF files...`
    });
    
    for (let i = 0; i < pdfFiles.length; i++) {
      const file = pdfFiles[i];
      try {
        // Send progress for current file start
        event.sender.send('processing-progress', {
          type: 'file-start',
          totalFiles: pdfFiles.length,
          currentFile: i + 1,
          fileName: file,
          message: `Processing file ${i + 1}/${pdfFiles.length}: ${file}`
        });

        const filePath = path.join(inputFolder, file);
        const dataBuffer = await fs.readFile(filePath);

        // Send progress for text extraction start
        event.sender.send('processing-progress', {
          type: 'extract-text',
          totalFiles: pdfFiles.length,
          currentFile: i + 1,
          fileName: file,
          message: `Extracting text from ${file} using ${processingMethod}...`
        });

        let pdfData;
        
        if (processingMethod === 'mistral') {
          // option 1: mistral ocr
          if (!mistralApiKey) {
            throw new Error('Mistral API key is required for Mistral OCR processing');
          }
          
          const client = new Mistral({ apiKey: mistralApiKey });
          const ocrResponse = await client.ocr.process({
            model: "mistral-ocr-latest",
            includeImageBase64: false,
            documentAnnotationFormat: responseFormatFromZodObject(DocumentSchema),
            document: {
              type: "document_url",              
              documentUrl: "data:application/pdf;base64," + dataBuffer.toString('base64'),            
            }			
          });
          const output = [];
          if(ocrResponse.pages) {
            for(const page of ocrResponse.pages){
              output.push(page.markdown);
            }
          }
          pdfData = {text: output.join("\f")};
          
          // Create JSON file if documentAnnotation exists
          if (ocrResponse.documentAnnotation) {
            const jsonFileName = path.parse(file).name + '.json';
            const jsonFilePath = path.join(outputFolder, jsonFileName);
            
            try {
              await fs.writeFile(jsonFilePath, JSON.stringify(JSON.parse(ocrResponse.documentAnnotation), null, 2));
              console.log(`Created JSON file: ${jsonFileName}`);
            } catch (jsonError) {
              console.error(`Failed to create JSON file for ${file}:`, jsonError);
            }
          }
        } else if (processingMethod === 'pdf-parse') {
          // option 2: pdf-parse
          pdfData = await pdfParse(dataBuffer);
        } else if (processingMethod === 'pdfreader') {
          // option 3: pdfreader (npm-pdfreader)
          pdfData = await extractTextWithPdfReader(dataBuffer);
        } else {
          throw new Error(`Unknown processing method: ${processingMethod}`);
        }
        
        // Send progress for AI extraction
        event.sender.send('processing-progress', {
          type: 'ai-extract',
          totalFiles: pdfFiles.length,
          currentFile: i + 1,
          fileName: file,
          message: `Extracting invoice information from ${file} using OpenAI...`
        });
        
        // Extract information using OpenAI
        const extractedInfo = await extractInvoiceInfo(openai, pdfData.text);
        
        if (extractedInfo) {
          // Send progress for file operations
          event.sender.send('processing-progress', {
            type: 'file-ops',
            totalFiles: pdfFiles.length,
            currentFile: i + 1,
            fileName: file,
            message: `Creating new filename and moving ${file}...`
          });

          // Create new filename
          const baseFileName = createSafeFilename(extractedInfo, file);
          
          // Ensure filename is unique to prevent overwrites
          const uniqueFileName = await getUniqueFilename(outputFolder, baseFileName);
          const outputPath = path.join(outputFolder, uniqueFileName);
          
          // Log if filename was changed due to collision
          if (baseFileName !== uniqueFileName) {
            console.log(`Filename collision detected: ${baseFileName} -> ${uniqueFileName}`);
          }
          
          // Copy file to output folder with error handling
          try {
            await fs.copyFile(filePath, outputPath);
            
            // Verify the file was copied successfully
            const stats = await fs.stat(outputPath);
            if (stats.size === 0) {
              throw new Error('Copied file is empty');
            }
            
            // Add to results
            results.push({
              originalFile: file,
              newFile: uniqueFileName,
              baseFileName: baseFileName, // Include original intended filename
              wasRenamed: baseFileName !== uniqueFileName,
              ...extractedInfo,
              status: 'success'
            });
            
            // Send success progress
            event.sender.send('processing-progress', {
              type: 'file-success',
              totalFiles: pdfFiles.length,
              currentFile: i + 1,
              fileName: file,
              newFileName: uniqueFileName,
              message: `✅ Successfully processed ${file} → ${uniqueFileName}`
            });
            
            // Delete original file only after successful copy and verification
            await fs.unlink(filePath);
            
          } catch (copyError) {
            console.error(`Failed to copy ${file}:`, copyError);
            
            // Send copy error progress
            event.sender.send('processing-progress', {
              type: 'file-error',
              totalFiles: pdfFiles.length,
              currentFile: i + 1,
              fileName: file,
              message: `❌ Failed to copy ${file}: ${copyError.message}`
            });
            
            results.push({
              originalFile: file,
              status: 'failed',
              error: `Copy failed: ${copyError.message}`
            });
          }
        } else {
          // Send extraction error progress
          event.sender.send('processing-progress', {
            type: 'file-error',
            totalFiles: pdfFiles.length,
            currentFile: i + 1,
            fileName: file,
            message: `❌ Failed to extract information from ${file}`
          });
          
          results.push({
            originalFile: file,
            status: 'failed',
            error: 'Could not extract information'
          });
        }
      } catch (error) {
        // Send general error progress
        event.sender.send('processing-progress', {
          type: 'file-error',
          totalFiles: pdfFiles.length,
          currentFile: i + 1,
          fileName: file,
          message: `❌ Error processing ${file}: ${error.message}`
        });
        
        results.push({
          originalFile: file,
          status: 'failed',
          error: error.message
        });
      }
    }
    
    // Send progress for Excel log update
    event.sender.send('processing-progress', {
      type: 'excel-update',
      totalFiles: pdfFiles.length,
      currentFile: pdfFiles.length,
      message: 'Updating Excel log file...'
    });
    
    // Update Excel log
    await updateExcelLog(logFile, results.filter(r => r.status === 'success'));
    
    // Send completion progress
    const successCount = results.filter(r => r.status === 'success').length;
    event.sender.send('processing-progress', {
      type: 'complete',
      totalFiles: pdfFiles.length,
      currentFile: pdfFiles.length,
      message: `🎉 Processing complete! Successfully processed ${successCount}/${pdfFiles.length} files.`
    });
    
    return results;
  } catch (error) {
    throw new Error(`Processing failed: ${error.message}`);
  }
});

async function extractTextWithPdfReader(dataBuffer) {
  return new Promise((resolve, reject) => {
    try {
      const textItems = [];
      let currentPage = 1;
      
      new PdfReader().parseBuffer(dataBuffer, (err, item) => {
        if (err) {
          console.error('PdfReader error:', err);
          reject(err);
          return;
        }
        
        if (!item) {
          // End of file - combine all text
          const combinedText = textItems.join(' ');
          resolve({ text: combinedText });
          return;
        }
        
        if (item.page) {
          // New page
          currentPage = item.page;
          if (currentPage > 1) {
            textItems.push('\f'); // Form feed character for page break
          }
        } else if (item.text) {
          // Text item
          textItems.push(item.text);
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function extractInvoiceInfo(openai, text) {
  try {
    const prompt = `
Extract the following information from this German invoice text:
- Rechnungsnummer (Invoice number)
- Datum (Date in DD.MM.YYYY format)
- Endbetrag (Final amount as number)
- Absender (Sender/Company name)

Text: ${text}

If any field cannot be found, use "N/A" as the value.
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      response_format: {
        "type": "json_schema",
        "json_schema": {
          "name": "rechnung",
          "strict": true,
          "schema": {
            "type": "object",
            "properties": {
              "rechnungsnummer": {
                "type": "string",
                "description": "The invoice number."
              },
              "datum": {
                "type": "string",
                "description": "The date of the invoice."
              },
              "endbetrag": {
                "type": "string",
                "description": "The total amount of the invoice."
              },
              "absender": {
                "type": "string",
                "description": "The sender of the invoice."
              }
            },
            "required": [
              "rechnungsnummer",
              "datum",
              "endbetrag",
              "absender"
            ],
            "additionalProperties": false
          }
        }
      },
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1
    });

    const content = response.choices[0].message.content.trim();
    
    // Try to parse JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return null;
  } catch (error) {
    console.error('OpenAI extraction error:', error);
    return null;
  }
}

// Helper function to convert date from DD.MM.YYYY to YYYY-MM-DD format
function convertDateToISO(dateStr) {
  if (!dateStr || dateStr === 'N/A') {
    return 'NA';
  }
  
  // Remove any whitespace
  const cleanDateStr = dateStr.trim();
  
  // Try to parse DD.MM.YYYY format
  const ddmmyyyyMatch = cleanDateStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (ddmmyyyyMatch) {
    const [, day, month, year] = ddmmyyyyMatch;
    // Validate the date components
    const dayNum = parseInt(day, 10);
    const monthNum = parseInt(month, 10);
    const yearNum = parseInt(year, 10);
    
    if (dayNum >= 1 && dayNum <= 31 && monthNum >= 1 && monthNum <= 12 && yearNum >= 1900 && yearNum <= 2100) {
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }
  
  // Try to parse other common date formats and convert them
  // DD/MM/YYYY format
  const ddmmyyyySlashMatch = cleanDateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyySlashMatch) {
    const [, day, month, year] = ddmmyyyySlashMatch;
    const dayNum = parseInt(day, 10);
    const monthNum = parseInt(month, 10);
    const yearNum = parseInt(year, 10);
    
    if (dayNum >= 1 && dayNum <= 31 && monthNum >= 1 && monthNum <= 12 && yearNum >= 1900 && yearNum <= 2100) {
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }
  
  // If already in YYYY-MM-DD format, keep it
  const yyyymmddMatch = cleanDateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (yyyymmddMatch) {
    const [, year, month, day] = yyyymmddMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  // If the date doesn't match expected format, sanitize it as is
  return sanitizeFilename(dateStr);
}

// Helper function to sanitize filename strings
function sanitizeFilename(str) {
  if (!str || str === 'N/A') {
    return 'NA';
  }
  
  // Replace invalid filename characters
  return str
    .replace(/[<>:"/\\|?*]/g, '_') // Replace invalid characters with underscore
    .replace(/\s+/g, '_') // Replace spaces with underscore
    .replace(/\.+/g, '_') // Replace dots with underscore (except file extension)
    .replace(/_+/g, '_') // Replace multiple underscores with single
    .replace(/^_|_$/g, '') // Remove leading/trailing underscores
    .substring(0, 50); // Limit length to avoid very long filenames
}

// Helper function to ensure unique filename
async function getUniqueFilename(outputFolder, baseFilename) {
  let filename = baseFilename;
  let counter = 1;
  
  // Check if file exists and create unique name if necessary
  while (true) {
    const fullPath = path.join(outputFolder, filename);
    try {
      await fs.access(fullPath);
      // File exists, try next number
      const nameWithoutExt = path.parse(baseFilename).name;
      const ext = path.parse(baseFilename).ext;
      filename = `${nameWithoutExt}_${counter}${ext}`;
      counter++;
    } catch (error) {
      // File doesn't exist, we can use this filename
      break;
    }
  }
  
  return filename;
}

// Helper function to create safe filename from extracted info
function createSafeFilename(extractedInfo, originalFilename) {
  const sanitizedDatum = convertDateToISO(extractedInfo.datum); // Convert date to YYYY-MM-DD format
  const sanitizedRechnungsnummer = sanitizeFilename(extractedInfo.rechnungsnummer);
  const sanitizedEndbetrag = sanitizeFilename(extractedInfo.endbetrag);
  const sanitizedAbsender = sanitizeFilename(extractedInfo.absender);
  
  // If all fields are N/A or empty, use original filename with timestamp
  if (sanitizedDatum === 'NA' && sanitizedRechnungsnummer === 'NA' && sanitizedEndbetrag === 'NA' && sanitizedAbsender === 'NA') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const nameWithoutExt = path.parse(originalFilename).name;
    return `${nameWithoutExt}_${timestamp}_unprocessed.pdf`;
  }
  
  // New format: YYYY-MM-DD_rechnungsnummer_EUR_endbetrag_absender.pdf
  return `${sanitizedDatum}_${sanitizedRechnungsnummer}_EUR_${sanitizedEndbetrag}_${sanitizedAbsender}.pdf`;
}

async function updateExcelLog(logPath, results) {
  let workbook;
  let worksheet;
  
  try {
    // Try to read existing file
    workbook = XLSX.readFile(logPath);
    worksheet = workbook.Sheets[workbook.SheetNames[0]];
  } catch (error) {
    // Create new workbook if file doesn't exist
    workbook = XLSX.utils.book_new();
    worksheet = XLSX.utils.aoa_to_sheet([
      ['Datum', 'Original File', 'New File', 'Rechnungsnummer', 'Datum', 'Endbetrag', 'Absender']
    ]);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'PDF Log');
  }
  
  // Get existing data
  const existingData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  
  // Add new rows
  results.forEach(result => {
    existingData.push([
      new Date().toLocaleDateString('de-DE'),
      result.originalFile,
      result.newFile,
      result.rechnungsnummer,
      result.datum,
      result.endbetrag,
      result.absender
    ]);
  });
  
  // Update worksheet
  const newWorksheet = XLSX.utils.aoa_to_sheet(existingData);
  workbook.Sheets[workbook.SheetNames[0]] = newWorksheet;
  
  // Save file
  XLSX.writeFile(workbook, logPath);
} 