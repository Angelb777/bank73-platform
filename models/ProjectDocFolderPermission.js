const mongoose = require('mongoose');

const PROJECT_DOC_FOLDERS = [
  'tecnico',
  'comercial',
  'financiero',
  'legal',
  'gerencia'
];

const SubfolderSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

const ProjectDocFolderPermissionSchema = new mongoose.Schema(
  {
    tenantKey: { type: String, required: true, index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    folder: { type: String, enum: PROJECT_DOC_FOLDERS, required: true, index: true },
    assignedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }],
    subfolders: [SubfolderSchema]
  },
  { timestamps: true }
);

ProjectDocFolderPermissionSchema.index(
  { tenantKey: 1, projectId: 1, folder: 1 },
  { unique: true }
);

module.exports = mongoose.model('ProjectDocFolderPermission', ProjectDocFolderPermissionSchema);
module.exports.PROJECT_DOC_FOLDERS = PROJECT_DOC_FOLDERS;
