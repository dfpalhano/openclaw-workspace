// Jess document search capability
// Allows Jess to search documents on the computer for answers

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Document directories to search
const DOCUMENT_DIRS = [
  '/home/diegopalhano/projects/mission-control/data',
  '/home/diegopalhano/projects/jess-bot',
  '/home/diegopalhano/.openclaw/workspace'
];

// Known document files
const KNOWN_DOCUMENTS = [
  '/home/diegopalhano/projects/jess-bot/diego-templates.txt',
  '/home/diegopalhano/projects/mission-control/data/jess-templates.txt',
  '/home/diegopalhano/projects/mission-control/data/mathis-conversation-framework.md',
  '/home/diegopalhano/projects/mission-control/data/room-numbering-rules.md'
];

// Search documents for relevant information
function searchDocuments(query) {
  const results = [];
  
  // Search in known documents first
  for (const docPath of KNOWN_DOCUMENTS) {
    if (fs.existsSync(docPath)) {
      try {
        const content = fs.readFileSync(docPath, 'utf8');
        const lines = content.split('\n');
        
        // Find lines containing query keywords
        const keywords = query.toLowerCase().split(/\s+/);
        const matchingLines = lines.filter(line => {
          const lowerLine = line.toLowerCase();
          return keywords.some(keyword => lowerLine.includes(keyword));
        });
        
        if (matchingLines.length > 0) {
          results.push({
            document: path.basename(docPath),
            path: docPath,
            matches: matchingLines.slice(0, 5), // Top 5 matches
            matchCount: matchingLines.length
          });
        }
      } catch (error) {
        // Skip if can't read
      }
    }
  }
  
  // Also search in document directories using grep (more comprehensive)
  try {
    const grepQuery = query.split(/\s+/).join('.*');
    const grepCmd = `grep -r -i -l "${grepQuery}" ${DOCUMENT_DIRS.join(' ')} 2>/dev/null | head -5`;
    const matchingFiles = execSync(grepCmd, { encoding: 'utf8' }).trim().split('\n').filter(f => f);
    
    for (const file of matchingFiles) {
      if (!results.some(r => r.path === file)) {
        try {
          const content = fs.readFileSync(file, 'utf8');
          const lines = content.split('\n');
          const matchingLines = lines.filter(line => 
            line.toLowerCase().includes(query.toLowerCase())
          ).slice(0, 3);
          
          if (matchingLines.length > 0) {
            results.push({
              document: path.basename(file),
              path: file,
              matches: matchingLines,
              matchCount: matchingLines.length
            });
          }
        } catch (error) {
          // Skip if can't read
        }
      }
    }
  } catch (error) {
    // grep might fail, that's okay
  }
  
  return results;
}

// Extract relevant information from documents for a query
function getDocumentContext(query) {
  const searchResults = searchDocuments(query);
  
  if (searchResults.length === 0) {
    return null;
  }
  
  // Format context for Jess's prompt
  let context = 'Relevant information from documents:\n\n';
  
  for (const result of searchResults.slice(0, 3)) { // Top 3 documents
    context += `From ${result.document}:\n`;
    for (const match of result.matches) {
      context += `- ${match.trim()}\n`;
    }
    context += '\n';
  }
  
  // Special handling for maintenance/contact queries
  const lowerQuery = query.toLowerCase();
  if (lowerQuery.includes('plumbing') || lowerQuery.includes('maintenance') || 
      lowerQuery.includes('issue') || lowerQuery.includes('problem') ||
      lowerQuery.includes('contact') || lowerQuery.includes('phone')) {
    
    // Extract contact information from templates
    const contactInfo = extractContactInfo();
    if (contactInfo) {
      context += '\nContact information for maintenance issues:\n';
      context += contactInfo + '\n';
    }
  }
  
  return context;
}

// Extract contact information from templates
function extractContactInfo() {
  try {
    const templatePath = '/home/diegopalhano/projects/jess-bot/diego-templates.txt';
    if (fs.existsSync(templatePath)) {
      const content = fs.readFileSync(templatePath, 'utf8');
      
      // Look for phone numbers and house manager names
      const phoneRegex = /(\+?61\s?\d{8,10}|04\d{2}\s?\d{3}\s?\d{3})/g;
      const phones = [...new Set(content.match(phoneRegex) || [])];
      
      // Look for house manager names
      const managerRegex = /(Dee|Mathis|Mathias|Kotaro)\s*(?:will be there|whatsapp|assist)/gi;
      const managers = [...new Set(content.match(managerRegex) || [])];
      
      let info = '';
      if (managers.length > 0) {
        info += `House managers mentioned: ${managers.slice(0, 3).join(', ')}\n`;
      }
      if (phones.length > 0) {
        info += `Contact numbers: ${phones.slice(0, 3).join(', ')}`;
      }
      
      return info || null;
    }
  } catch (error) {
    // Ignore errors
  }
  return null;
}

// Check if query is about something that should be in documents
function isDocumentQuery(query) {
  const documentTopics = [
    'bond', 'plumbing', 'maintenance', 'inspection', 'template',
    'contract', 'agreement', 'policy', 'procedure', 'guideline',
    'form', 'document', 'file', 'record', 'template', 'example',
    'how to', 'process', 'steps', 'checklist', 'protocol',
    'issue', 'problem', 'fix', 'repair', 'contact', 'phone', 'number',
    'manager', 'emergency', 'urgent'
  ];
  
  const lowerQuery = query.toLowerCase();
  return documentTopics.some(topic => lowerQuery.includes(topic));
}

module.exports = {
  searchDocuments,
  getDocumentContext,
  isDocumentQuery,
  extractContactInfo
};
