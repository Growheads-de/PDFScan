import React, { useState, useEffect, useRef } from 'react';
import {
  Container,
  Paper,
  Typography,
  TextField,
  Button,
  Box,
  Grid,
  Alert,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Divider,
  Snackbar,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormHelperText,
  Tabs,
  Tab
} from '@mui/material';
import {
  FolderOpen,
  Description,
  VpnKey,
  PlayArrow,
  CheckCircle,
  Error,
  Settings,
  Scanner
} from '@mui/icons-material';
import { createTheme, ThemeProvider } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    primary: {
      main: '#1976d2',
    },
    secondary: {
      main: '#dc004e',
    },
  },
});

function App() {
  const [config, setConfig] = useState({
    inputFolder: '',
    outputFolder: '',
    logFile: '',
    apiKey: '',
    mistralApiKey: '',
    processingMethod: 'pdfreader'
  });
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [showSaveNotification, setShowSaveNotification] = useState(false);
  const [saveNotificationMessage, setSaveNotificationMessage] = useState('');
  const [progressUpdates, setProgressUpdates] = useState([]);
  const [currentProgress, setCurrentProgress] = useState(null);
  const [activeTab, setActiveTab] = useState(0);
  
  // Use ref to track initial load - avoids React batching issues
  const isInitialLoadRef = useRef(true);
  
  // Refs for auto-scroll functionality
  const resultsRef = useRef(null);
  const progressRef = useRef(null);
  const progressUpdatesRef = useRef(null);

  // Load stored API key and config on component mount
  useEffect(() => {
    const loadStoredData = async () => {
      try {
        // Load API keys
        const storedApiKey = await window.electronAPI.loadApiKey();
        const storedMistralApiKey = await window.electronAPI.loadMistralApiKey();
        
        // Load folder configuration
        const storedConfig = await window.electronAPI.loadConfig();
        
        setConfig(prev => ({
          ...prev,
          apiKey: storedApiKey || '',
          mistralApiKey: storedMistralApiKey || '',
          inputFolder: storedConfig.inputFolder || '',
          outputFolder: storedConfig.outputFolder || '',
          logFile: storedConfig.logFile || '',
          processingMethod: storedConfig.processingMethod || 'pdfreader'
        }));
        
        // Mark initial load as complete after config is set
        setTimeout(() => {
          isInitialLoadRef.current = false;
        }, 100);
      } catch (err) {
        console.error('Failed to load stored data:', err);
        isInitialLoadRef.current = false;
      }
    };

    loadStoredData();
  }, []);

  // Set up progress update listener
  useEffect(() => {
    const handleProgressUpdate = (progressData) => {
      setCurrentProgress(progressData);
      setProgressUpdates(prev => [...prev, { ...progressData, timestamp: new Date() }]);
    };

    window.electronAPI.onProcessingProgress(handleProgressUpdate);

    return () => {
      window.electronAPI.removeProcessingProgressListener();
    };
  }, []);

  // Auto-scroll to progress bar when processing starts
  useEffect(() => {
    if (processing && progressRef.current) {
      setTimeout(() => {
        if (progressRef.current) {
          progressRef.current.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center' 
          });
        }
      }, 100);
    }
  }, [processing]);

  // Auto-scroll to latest progress update
  useEffect(() => {
    if (progressUpdates.length > 0 && progressUpdatesRef.current && processing) {
      // Scroll to bottom of progress updates
      setTimeout(() => {
        if (progressUpdatesRef.current) {
          progressUpdatesRef.current.scrollTop = progressUpdatesRef.current.scrollHeight;
        }
      }, 100);
    }
  }, [progressUpdates, processing]);

  // Auto-scroll to results when they come in
  useEffect(() => {
    if (results.length > 0 && resultsRef.current) {
      // Small delay to ensure the results section is fully rendered
      setTimeout(() => {
        if (resultsRef.current) {
          resultsRef.current.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'start' 
          });
        }
      }, 100);
    }
  }, [results]);

  // Save API key manually when user changes it
  const handleApiKeyChange = async (newApiKey) => {
    setConfig(prev => ({ ...prev, apiKey: newApiKey }));
    
    // Only save if not during initial load and has actual value
    if (!isInitialLoadRef.current && newApiKey) {
      try {
        const saved = await window.electronAPI.saveApiKey(newApiKey);
        if (saved) {
          setSaveNotificationMessage('OpenAI API key saved securely');
          setShowSaveNotification(true);
          setTimeout(() => setShowSaveNotification(false), 2000);
        }
      } catch (err) {
        console.error('Failed to save API key:', err);
      }
    }
  };

  // Save Mistral API key manually when user changes it
  const handleMistralApiKeyChange = async (newApiKey) => {
    setConfig(prev => ({ ...prev, mistralApiKey: newApiKey }));
    
    // Only save if not during initial load and has actual value
    if (!isInitialLoadRef.current && newApiKey) {
      try {
        const saved = await window.electronAPI.saveMistralApiKey(newApiKey);
        if (saved) {
          setSaveNotificationMessage('Mistral API key saved securely');
          setShowSaveNotification(true);
          setTimeout(() => setShowSaveNotification(false), 2000);
        }
      } catch (err) {
        console.error('Failed to save Mistral API key:', err);
      }
    }
  };

  const handleFolderSelect = async (type) => {
    try {
      const folderPath = await window.electronAPI.selectFolder();
      if (folderPath) {
        setConfig(prev => ({
          ...prev,
          [type]: folderPath
        }));
        
        // Save configuration immediately after user selection
        if (!isInitialLoadRef.current) {
          try {
            const configToSave = {
              inputFolder: type === 'inputFolder' ? folderPath : config.inputFolder,
              outputFolder: type === 'outputFolder' ? folderPath : config.outputFolder,
              logFile: config.logFile,
              processingMethod: config.processingMethod
            };
            await window.electronAPI.saveConfig(configToSave);
            setSaveNotificationMessage('Folder configuration saved');
            setShowSaveNotification(true);
            setTimeout(() => setShowSaveNotification(false), 2000);
          } catch (err) {
            console.error('Failed to save config:', err);
          }
        }
      }
    } catch (err) {
      setError('Failed to select folder');
    }
  };

  // Handle processing method change
  const handleProcessingMethodChange = async (newMethod) => {
    setConfig(prev => ({ ...prev, processingMethod: newMethod }));
    
    // Save configuration immediately after user selection
    if (!isInitialLoadRef.current) {
      try {
        const configToSave = {
          inputFolder: config.inputFolder,
          outputFolder: config.outputFolder,
          logFile: config.logFile,
          processingMethod: newMethod
        };
        await window.electronAPI.saveConfig(configToSave);
        setSaveNotificationMessage('Processing method saved');
        setShowSaveNotification(true);
        setTimeout(() => setShowSaveNotification(false), 2000);
      } catch (err) {
        console.error('Failed to save config:', err);
      }
    }
  };

  const handleFileSelect = async () => {
    try {
      const filePath = await window.electronAPI.selectExcelFile();
      if (filePath) {
        setConfig(prev => ({
          ...prev,
          logFile: filePath
        }));
        
        // Save configuration immediately after user selection
        if (!isInitialLoadRef.current) {
          try {
            const configToSave = {
              inputFolder: config.inputFolder,
              outputFolder: config.outputFolder,
              logFile: filePath,
              processingMethod: config.processingMethod
            };
            await window.electronAPI.saveConfig(configToSave);
            setSaveNotificationMessage('Excel log file saved');
            setShowSaveNotification(true);
            setTimeout(() => setShowSaveNotification(false), 2000);
          } catch (err) {
            console.error('Failed to save config:', err);
          }
        }
      }
    } catch (err) {
      setError('Failed to select/create Excel file');
    }
  };

  const handleScan = async () => {
    if (!config.inputFolder || !config.outputFolder || !config.logFile || !config.apiKey) {
      setError('Please fill in all required fields');
      return;
    }

    if (config.processingMethod === 'mistral' && !config.mistralApiKey) {
      setError('Mistral API key is required when using Mistral OCR processing');
      return;
    }

    setProcessing(true);
    setError('');
    setResults([]);
    setProgressUpdates([]);
    setCurrentProgress(null);
    
    // Switch to Scanner tab when processing starts
    setActiveTab(1);

    try {
      const scanResults = await window.electronAPI.processPdfs(config);
      setResults(scanResults);
    } catch (err) {
      setError(err.message || 'Processing failed');
    } finally {
      setProcessing(false);
    }
  };

  const isConfigValid = () => {
    const baseValid = config.inputFolder && config.outputFolder && config.logFile && config.apiKey;
    const mistralValid = config.processingMethod !== 'mistral' || config.mistralApiKey;
    return baseValid && mistralValid;
  };

  const handleTabChange = (event, newValue) => {
    setActiveTab(newValue);
  };

  const renderSettingsTab = () => (
    <Grid container spacing={3}>
      {/* Input Folder */}
      <Grid item xs={12} md={6}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Button
            variant="outlined"
            startIcon={<FolderOpen />}
            onClick={() => handleFolderSelect('inputFolder')}
            fullWidth
          >
            Select Input Folder
          </Button>
        </Box>
        <TextField
          fullWidth
          label="Input Folder Path"
          value={config.inputFolder}
          InputProps={{ readOnly: true }}
          size="small"
          sx={{ mt: 1 }}
        />
      </Grid>

      {/* Output Folder */}
      <Grid item xs={12} md={6}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Button
            variant="outlined"
            startIcon={<FolderOpen />}
            onClick={() => handleFolderSelect('outputFolder')}
            fullWidth
          >
            Select Output Folder
          </Button>
        </Box>
        <TextField
          fullWidth
          label="Output Folder Path"
          value={config.outputFolder}
          InputProps={{ readOnly: true }}
          size="small"
          sx={{ mt: 1 }}
        />
      </Grid>

      {/* Log File */}
      <Grid item xs={12} md={6}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Button
            variant="outlined"
            startIcon={<Description />}
            onClick={handleFileSelect}
            fullWidth
          >
            Select/Create Excel Log File
          </Button>
        </Box>
        <TextField
          fullWidth
          label="Excel Log File Path"
          value={config.logFile}
          InputProps={{ readOnly: true }}
          size="small"
          sx={{ mt: 1 }}
          helperText="Choose existing file or create a new Excel log file"
        />
      </Grid>

      {/* Processing Method */}
      <Grid item xs={12} md={6}>
        <FormControl fullWidth>
          <InputLabel>Processing Method</InputLabel>
          <Select
            value={config.processingMethod}
            label="Processing Method"
            onChange={(e) => handleProcessingMethodChange(e.target.value)}
          >
            <MenuItem value="mistral">Mistral OCR (Better for scanned documents)</MenuItem>
            <MenuItem value="pdf-parse">PDF Parse (Faster for text-based PDFs)</MenuItem>
            <MenuItem value="pdfreader">PDF Reader (Rule-based parsing with table support)</MenuItem>
          </Select>
          <FormHelperText>Choose the PDF processing method</FormHelperText>
        </FormControl>
      </Grid>

      {/* OpenAI API Key */}
      <Grid item xs={12} md={6}>
        <TextField
          fullWidth
          label="OpenAI API Key"
          type="password"
          value={config.apiKey}
          onChange={(e) => handleApiKeyChange(e.target.value)}
          InputProps={{
            startAdornment: <VpnKey sx={{ mr: 1, color: 'text.secondary' }} />
          }}
          helperText="Enter your OpenAI API key (required for data extraction)"
        />
      </Grid>

      {/* Mistral API Key */}
      {config.processingMethod === 'mistral' && (
        <Grid item xs={12} md={6}>
          <TextField
            fullWidth
            label="Mistral API Key"
            type="password"
            value={config.mistralApiKey}
            onChange={(e) => handleMistralApiKeyChange(e.target.value)}
            InputProps={{
              startAdornment: <VpnKey sx={{ mr: 1, color: 'text.secondary' }} />
            }}
            helperText="Enter your Mistral API key (required for Mistral OCR)"
          />
        </Grid>
      )}
    </Grid>
  );

  const renderScannerTab = () => (
    <Box>
      {/* Scan Button */}
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
        <Button
          variant="contained"
          size="large"
          startIcon={<PlayArrow />}
          onClick={handleScan}
          disabled={!isConfigValid() || processing}
          sx={{ minWidth: 200 }}
        >
          {processing ? 'Scanning...' : 'Start Scan'}
        </Button>
      </Box>

      {/* Configuration Status */}
      <Paper elevation={1} sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Configuration Status
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6} md={3}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {config.inputFolder ? (
                <CheckCircle color="success" fontSize="small" />
              ) : (
                <Error color="error" fontSize="small" />
              )}
              <Typography variant="body2">
                Input Folder: {config.inputFolder ? '✓' : 'Not set'}
              </Typography>
            </Box>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {config.outputFolder ? (
                <CheckCircle color="success" fontSize="small" />
              ) : (
                <Error color="error" fontSize="small" />
              )}
              <Typography variant="body2">
                Output Folder: {config.outputFolder ? '✓' : 'Not set'}
              </Typography>
            </Box>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {config.logFile ? (
                <CheckCircle color="success" fontSize="small" />
              ) : (
                <Error color="error" fontSize="small" />
              )}
              <Typography variant="body2">
                Log File: {config.logFile ? '✓' : 'Not set'}
              </Typography>
            </Box>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {config.apiKey && (config.processingMethod !== 'mistral' || config.mistralApiKey) ? (
                <CheckCircle color="success" fontSize="small" />
              ) : (
                <Error color="error" fontSize="small" />
              )}
              <Typography variant="body2">
                API Keys: {config.apiKey && (config.processingMethod !== 'mistral' || config.mistralApiKey) ? '✓' : 'Missing'}
              </Typography>
            </Box>
          </Grid>
        </Grid>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Processing Method: {config.processingMethod === 'mistral' ? 'Mistral OCR' : 
                             config.processingMethod === 'pdf-parse' ? 'PDF Parse' : 'PDF Reader'}
        </Typography>
      </Paper>

      {/* Progress Bar */}
      {processing && (
        <Box sx={{ mt: 3 }} ref={progressRef}>
          <LinearProgress 
            variant={currentProgress ? "determinate" : "indeterminate"}
            value={currentProgress ? (currentProgress.currentFile / currentProgress.totalFiles) * 100 : 0}
          />
          <Typography variant="body2" align="center" sx={{ mt: 1 }}>
            {currentProgress ? currentProgress.message : 'Processing PDF files...'}
          </Typography>
          
          {/* Real-time Progress Updates */}
          {progressUpdates.length > 0 && (
            <Paper elevation={1} sx={{ mt: 2, p: 2, maxHeight: 300, overflow: 'auto' }} ref={progressUpdatesRef}>
              <Typography variant="h6" gutterBottom>
                Processing Steps
              </Typography>
              <List dense>
                {progressUpdates.slice(-10).map((update, index) => (
                  <ListItem key={index} sx={{ py: 0.5 }}>
                    <ListItemIcon sx={{ minWidth: 30 }}>
                      {update.type === 'file-success' ? (
                        <CheckCircle color="success" fontSize="small" />
                      ) : update.type === 'file-error' ? (
                        <Error color="error" fontSize="small" />
                      ) : (
                        <Box 
                          sx={{ 
                            width: 8, 
                            height: 8, 
                            borderRadius: '50%', 
                            bgcolor: 'primary.main' 
                          }} 
                        />
                      )}
                    </ListItemIcon>
                    <ListItemText
                      primary={update.message}
                      secondary={update.timestamp.toLocaleTimeString()}
                      primaryTypographyProps={{ fontSize: '0.875rem' }}
                      secondaryTypographyProps={{ fontSize: '0.75rem' }}
                    />
                  </ListItem>
                ))}
              </List>
              {progressUpdates.length > 10 && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  Showing last 10 updates (total: {progressUpdates.length})
                </Typography>
              )}
            </Paper>
          )}
        </Box>
      )}

      {/* Error Display */}
      {error && (
        <Alert severity="error" sx={{ mt: 3 }}>
          {error}
        </Alert>
      )}

      {/* Results Display */}
      {results.length > 0 && (
        <Paper elevation={1} sx={{ mt: 3, p: 2 }} ref={resultsRef}>
          <Typography variant="h6" gutterBottom>
            Processing Results
          </Typography>
          
          {/* Summary Alerts */}
          {(() => {
            const successfulResults = results.filter(r => r.status === 'success');
            const renamedResults = successfulResults.filter(r => r.wasRenamed);
            const noDataResults = successfulResults.filter(r => 
              r.datum === 'N/A' && r.rechnungsnummer === 'N/A' && r.endbetrag === 'N/A'
            );
            
            return (
              <>
                {renamedResults.length > 0 && (
                  <Alert severity="warning" sx={{ mb: 2 }}>
                    {renamedResults.length} file(s) were renamed to prevent overwrites due to duplicate names.
                  </Alert>
                )}
                {noDataResults.length > 0 && (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    {noDataResults.length} file(s) had no extractable invoice data. These files may not contain readable invoices or may need manual processing.
                  </Alert>
                )}
              </>
            );
          })()}
          
          <List>
            {results.map((result, index) => (
              <React.Fragment key={index}>
                <ListItem>
                  <ListItemIcon>
                    {result.status === 'success' ? (
                      <CheckCircle color="success" />
                    ) : (
                      <Error color="error" />
                    )}
                  </ListItemIcon>
                  <ListItemText
                    primary={result.originalFile}
                    secondary={
                      result.status === 'success'
                        ? (
                            <>
                              <span>Renamed to: {result.newFile}</span>
                              {result.wasRenamed && (
                                <span style={{ color: '#ff9800', display: 'block', fontSize: '0.8em' }}>
                                  ⚠️ Filename was modified to prevent collision (original: {result.baseFileName})
                                </span>
                              )}
                              {result.datum === 'N/A' && result.rechnungsnummer === 'N/A' && result.endbetrag === 'N/A' && (
                                <span style={{ color: '#2196f3', display: 'block', fontSize: '0.8em' }}>
                                  ℹ️ No invoice data could be extracted
                                </span>
                              )}
                            </>
                          )
                        : `Error: ${result.error}`
                    }
                  />
                </ListItem>
                {index < results.length - 1 && <Divider />}
              </React.Fragment>
            ))}
          </List>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Successfully processed: {results.filter(r => r.status === 'success').length} / {results.length} files
          </Typography>
        </Paper>
      )}
    </Box>
  );

  return (
    <ThemeProvider theme={theme}>
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Paper elevation={3} sx={{ p: 4 }}>
          <Typography variant="h4" component="h1" gutterBottom align="center">
            PDF Invoice Scanner
          </Typography>
          <Typography variant="subtitle1" align="center" color="text.secondary" gutterBottom>
            AI-powered invoice processing with configurable OCR methods
          </Typography>

          <Box sx={{ mt: 4 }}>
            {/* Tab Navigation */}
            <Tabs value={activeTab} onChange={handleTabChange} centered sx={{ mb: 3 }}>
              <Tab icon={<Settings />} label="Settings" />
              <Tab icon={<Scanner />} label="Scanner" />
            </Tabs>

            {/* Tab Content */}
            {activeTab === 0 && renderSettingsTab()}
            {activeTab === 1 && renderScannerTab()}
          </Box>
        </Paper>

        {/* API Key Save Notification */}
        <Snackbar
          open={showSaveNotification}
          autoHideDuration={2000}
          onClose={() => setShowSaveNotification(false)}
          message={saveNotificationMessage}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        />
      </Container>
    </ThemeProvider>
  );
}

export default App; 