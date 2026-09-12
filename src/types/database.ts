export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      account_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by_user_id: string | null
          account_id: string
          created_at: string
          created_by_user_id: string | null
          expires_at: string
          id: string
          label: string | null
          role: Database["public"]["Enums"]["account_role_enum"]
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by_user_id?: string | null
          account_id: string
          created_at?: string
          created_by_user_id?: string | null
          expires_at: string
          id?: string
          label?: string | null
          role: Database["public"]["Enums"]["account_role_enum"]
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by_user_id?: string | null
          account_id?: string
          created_at?: string
          created_by_user_id?: string | null
          expires_at?: string
          id?: string
          label?: string | null
          role?: Database["public"]["Enums"]["account_role_enum"]
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_invitations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          created_at: string
          default_currency: string
          id: string
          name: string
          owner_user_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_currency?: string
          id?: string
          name: string
          owner_user_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_currency?: string
          id?: string
          name?: string
          owner_user_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_configs: {
        Row: {
          account_id: string
          api_key: string
          auto_reply_enabled: boolean
          auto_reply_max_per_conversation: number
          behaviour: Json
          created_at: string
          created_by: string | null
          embeddings_api_key: string | null
          handoff_agent_id: string | null
          id: string
          identity: Json
          is_active: boolean
          model: string
          provider: string
          status: string
          system_prompt: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          api_key: string
          auto_reply_enabled?: boolean
          auto_reply_max_per_conversation?: number
          behaviour?: Json
          created_at?: string
          created_by?: string | null
          embeddings_api_key?: string | null
          handoff_agent_id?: string | null
          id?: string
          identity?: Json
          is_active?: boolean
          model: string
          provider: string
          status?: string
          system_prompt?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          api_key?: string
          auto_reply_enabled?: boolean
          auto_reply_max_per_conversation?: number
          behaviour?: Json
          created_at?: string
          created_by?: string | null
          embeddings_api_key?: string | null
          handoff_agent_id?: string | null
          id?: string
          identity?: Json
          is_active?: boolean
          model?: string
          provider?: string
          status?: string
          system_prompt?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_configs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_goal_completions: {
        Row: {
          account_id: string
          ai_config_id: string
          ai_goal_id: string
          completed_at: string
          contact_id: string | null
          conversation_id: string | null
          id: string
          metadata: Json
        }
        Insert: {
          account_id: string
          ai_config_id: string
          ai_goal_id: string
          completed_at?: string
          contact_id?: string | null
          conversation_id?: string | null
          id?: string
          metadata?: Json
        }
        Update: {
          account_id?: string
          ai_config_id?: string
          ai_goal_id?: string
          completed_at?: string
          contact_id?: string | null
          conversation_id?: string | null
          id?: string
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ai_goal_completions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_goal_completions_ai_config_id_fkey"
            columns: ["ai_config_id"]
            isOneToOne: false
            referencedRelation: "ai_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_goal_completions_ai_goal_id_fkey"
            columns: ["ai_goal_id"]
            isOneToOne: false
            referencedRelation: "ai_goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_goal_completions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_goal_completions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_goals: {
        Row: {
          account_id: string
          ai_config_id: string
          created_at: string
          description: string | null
          enabled: boolean
          id: string
          kind: string
          name: string
          params: Json
          priority: number
          updated_at: string
        }
        Insert: {
          account_id: string
          ai_config_id: string
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          kind: string
          name: string
          params?: Json
          priority?: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          ai_config_id?: string
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          kind?: string
          name?: string
          params?: Json
          priority?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_goals_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_goals_ai_config_id_fkey"
            columns: ["ai_config_id"]
            isOneToOne: false
            referencedRelation: "ai_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_knowledge_chunks: {
        Row: {
          account_id: string
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          fts: unknown
          id: string
        }
        Insert: {
          account_id: string
          chunk_index?: number
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          fts?: unknown
          id?: string
        }
        Update: {
          account_id?: string
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          fts?: unknown
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_knowledge_chunks_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_knowledge_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "ai_knowledge_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_knowledge_documents: {
        Row: {
          account_id: string
          char_count: number
          chunk_count: number
          content: string
          created_at: string
          created_by: string | null
          error_message: string | null
          id: string
          source_type: string
          source_url: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          account_id: string
          char_count?: number
          chunk_count?: number
          content: string
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          source_type?: string
          source_url?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          char_count?: number
          chunk_count?: number
          content?: string
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          source_type?: string
          source_url?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_knowledge_documents_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_log: {
        Row: {
          account_id: string
          completion_tokens: number
          conversation_id: string | null
          created_at: string
          id: string
          mode: string
          model: string
          prompt_tokens: number
          provider: string
          total_tokens: number
        }
        Insert: {
          account_id: string
          completion_tokens?: number
          conversation_id?: string | null
          created_at?: string
          id?: string
          mode: string
          model: string
          prompt_tokens?: number
          provider: string
          total_tokens?: number
        }
        Update: {
          account_id?: string
          completion_tokens?: number
          conversation_id?: string | null
          created_at?: string
          id?: string
          mode?: string
          model?: string
          prompt_tokens?: number
          provider?: string
          total_tokens?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_log_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_log_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          scopes: string[]
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          scopes?: string[]
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          scopes?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_run_steps: {
        Row: {
          account_id: string
          attempt: number
          error: string | null
          finished_at: string | null
          id: string
          idempotency_key: string
          input: Json
          node_id: string
          node_type: string
          output: Json | null
          run_id: string
          started_at: string
          status: string
        }
        Insert: {
          account_id: string
          attempt?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key: string
          input?: Json
          node_id: string
          node_type: string
          output?: Json | null
          run_id: string
          started_at?: string
          status: string
        }
        Update: {
          account_id?: string
          attempt?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string
          input?: Json
          node_id?: string
          node_type?: string
          output?: Json | null
          run_id?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_run_steps_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_run_steps_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "automation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_runs: {
        Row: {
          account_id: string
          attempt: number
          automation_id: string
          completed_at: string | null
          contact_id: string
          context: Json
          created_at: string
          current_node_id: string | null
          id: string
          last_error: string | null
          node_executions: number
          status: string
          trigger_event_id: string | null
          updated_at: string
          version_id: string
          wait_until: string | null
        }
        Insert: {
          account_id: string
          attempt?: number
          automation_id: string
          completed_at?: string | null
          contact_id: string
          context?: Json
          created_at?: string
          current_node_id?: string | null
          id?: string
          last_error?: string | null
          node_executions?: number
          status?: string
          trigger_event_id?: string | null
          updated_at?: string
          version_id: string
          wait_until?: string | null
        }
        Update: {
          account_id?: string
          attempt?: number
          automation_id?: string
          completed_at?: string | null
          contact_id?: string
          context?: Json
          created_at?: string
          current_node_id?: string | null
          id?: string
          last_error?: string | null
          node_executions?: number
          status?: string
          trigger_event_id?: string | null
          updated_at?: string
          version_id?: string
          wait_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_runs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_runs_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_runs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_runs_trigger_event_id_fkey"
            columns: ["trigger_event_id"]
            isOneToOne: false
            referencedRelation: "domain_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_runs_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "automation_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_versions: {
        Row: {
          account_id: string
          automation_id: string
          graph: Json
          id: string
          published_at: string
          published_by: string | null
          trigger: Json
          version_number: number
        }
        Insert: {
          account_id: string
          automation_id: string
          graph: Json
          id?: string
          published_at?: string
          published_by?: string | null
          trigger: Json
          version_number: number
        }
        Update: {
          account_id?: string
          automation_id?: string
          graph?: Json
          id?: string
          published_at?: string
          published_by?: string | null
          trigger?: Json
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "automation_versions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_versions_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_waits: {
        Row: {
          account_id: string
          claimed_at: string | null
          created_at: string
          id: string
          node_id: string
          resume_at: string
          resume_node_id: string | null
          run_id: string
          status: string
        }
        Insert: {
          account_id: string
          claimed_at?: string | null
          created_at?: string
          id?: string
          node_id: string
          resume_at: string
          resume_node_id?: string | null
          run_id: string
          status?: string
        }
        Update: {
          account_id?: string
          claimed_at?: string | null
          created_at?: string
          id?: string
          node_id?: string
          resume_at?: string
          resume_node_id?: string | null
          run_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_waits_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_waits_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "automation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      automations: {
        Row: {
          account_id: string
          created_at: string
          created_by: string
          description: string | null
          draft_graph: Json
          draft_trigger: Json | null
          id: string
          name: string
          published_version_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by: string
          description?: string | null
          draft_graph?: Json
          draft_trigger?: Json | null
          id?: string
          name: string
          published_version_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string
          description?: string | null
          draft_graph?: Json
          draft_trigger?: Json | null
          id?: string
          name?: string
          published_version_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automations_published_version_id_fkey"
            columns: ["published_version_id"]
            isOneToOne: false
            referencedRelation: "automation_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_recipients: {
        Row: {
          broadcast_id: string
          contact_id: string | null
          created_at: string | null
          delivered_at: string | null
          error_message: string | null
          id: string
          read_at: string | null
          replied_at: string | null
          sent_at: string | null
          status: string
          template_params: Json | null
          whatsapp_message_id: string | null
        }
        Insert: {
          broadcast_id: string
          contact_id?: string | null
          created_at?: string | null
          delivered_at?: string | null
          error_message?: string | null
          id?: string
          read_at?: string | null
          replied_at?: string | null
          sent_at?: string | null
          status?: string
          template_params?: Json | null
          whatsapp_message_id?: string | null
        }
        Update: {
          broadcast_id?: string
          contact_id?: string | null
          created_at?: string | null
          delivered_at?: string | null
          error_message?: string | null
          id?: string
          read_at?: string | null
          replied_at?: string | null
          sent_at?: string | null
          status?: string
          template_params?: Json | null
          whatsapp_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_recipients_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "broadcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcasts: {
        Row: {
          account_id: string
          audience_filter: Json | null
          created_at: string | null
          delivered_count: number | null
          delivery_locked_at: string | null
          failed_count: number | null
          id: string
          name: string
          read_count: number | null
          replied_count: number | null
          scheduled_at: string | null
          sent_count: number | null
          status: string
          template_language: string
          template_name: string
          template_variables: Json | null
          total_recipients: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          account_id: string
          audience_filter?: Json | null
          created_at?: string | null
          delivered_count?: number | null
          delivery_locked_at?: string | null
          failed_count?: number | null
          id?: string
          name: string
          read_count?: number | null
          replied_count?: number | null
          scheduled_at?: string | null
          sent_count?: number | null
          status?: string
          template_language?: string
          template_name: string
          template_variables?: Json | null
          total_recipients?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          account_id?: string
          audience_filter?: Json | null
          created_at?: string | null
          delivered_count?: number | null
          delivery_locked_at?: string | null
          failed_count?: number | null
          id?: string
          name?: string
          read_count?: number | null
          replied_count?: number | null
          scheduled_at?: string | null
          sent_count?: number | null
          status?: string
          template_language?: string
          template_name?: string
          template_variables?: Json | null
          total_recipients?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcasts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_custom_values: {
        Row: {
          contact_id: string
          created_at: string | null
          custom_field_id: string
          id: string
          value: string | null
        }
        Insert: {
          contact_id: string
          created_at?: string | null
          custom_field_id: string
          id?: string
          value?: string | null
        }
        Update: {
          contact_id?: string
          created_at?: string | null
          custom_field_id?: string
          id?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_custom_values_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_custom_values_custom_field_id_fkey"
            columns: ["custom_field_id"]
            isOneToOne: false
            referencedRelation: "custom_fields"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_notes: {
        Row: {
          account_id: string
          contact_id: string
          created_at: string | null
          id: string
          note_text: string
          user_id: string
        }
        Insert: {
          account_id: string
          contact_id: string
          created_at?: string | null
          id?: string
          note_text: string
          user_id: string
        }
        Update: {
          account_id?: string
          contact_id?: string
          created_at?: string | null
          id?: string
          note_text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_notes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_notes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_tags: {
        Row: {
          contact_id: string
          created_at: string | null
          id: string
          tag_id: string
        }
        Insert: {
          contact_id: string
          created_at?: string | null
          id?: string
          tag_id: string
        }
        Update: {
          contact_id?: string
          created_at?: string | null
          id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_tags_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          account_id: string
          avatar_url: string | null
          company: string | null
          created_at: string | null
          email: string | null
          id: string
          name: string | null
          phone: string | null
          phone_normalized: string | null
          telegram_chat_id: number | null
          telegram_user_id: number | null
          telegram_username: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          account_id: string
          avatar_url?: string | null
          company?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string | null
          phone?: string | null
          phone_normalized?: string | null
          telegram_chat_id?: number | null
          telegram_user_id?: number | null
          telegram_username?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          account_id?: string
          avatar_url?: string | null
          company?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string | null
          phone?: string | null
          phone_normalized?: string | null
          telegram_chat_id?: number | null
          telegram_user_id?: number | null
          telegram_username?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          account_id: string
          ai_autoreply_disabled: boolean
          ai_handoff_summary: string | null
          ai_reply_count: number
          assigned_agent_id: string | null
          contact_id: string
          created_at: string | null
          id: string
          last_message_at: string | null
          last_message_text: string | null
          status: string
          unread_count: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          account_id: string
          ai_autoreply_disabled?: boolean
          ai_handoff_summary?: string | null
          ai_reply_count?: number
          assigned_agent_id?: string | null
          contact_id: string
          created_at?: string | null
          id?: string
          last_message_at?: string | null
          last_message_text?: string | null
          status?: string
          unread_count?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          account_id?: string
          ai_autoreply_disabled?: boolean
          ai_handoff_summary?: string | null
          ai_reply_count?: number
          assigned_agent_id?: string | null
          contact_id?: string
          created_at?: string | null
          id?: string
          last_message_at?: string | null
          last_message_text?: string | null
          status?: string
          unread_count?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_fields: {
        Row: {
          account_id: string
          created_at: string | null
          field_name: string
          field_options: Json | null
          field_type: string
          id: string
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string | null
          field_name: string
          field_options?: Json | null
          field_type?: string
          id?: string
          user_id: string
        }
        Update: {
          account_id?: string
          created_at?: string | null
          field_name?: string
          field_options?: Json | null
          field_type?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_fields_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          account_id: string
          assigned_to: string | null
          contact_id: string | null
          conversation_id: string | null
          created_at: string | null
          currency: string | null
          expected_close_date: string | null
          id: string
          notes: string | null
          pipeline_id: string
          stage_id: string
          status: string | null
          title: string
          updated_at: string | null
          user_id: string
          value: number
        }
        Insert: {
          account_id: string
          assigned_to?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string | null
          currency?: string | null
          expected_close_date?: string | null
          id?: string
          notes?: string | null
          pipeline_id: string
          stage_id: string
          status?: string | null
          title: string
          updated_at?: string | null
          user_id: string
          value?: number
        }
        Update: {
          account_id?: string
          assigned_to?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string | null
          currency?: string | null
          expected_close_date?: string | null
          id?: string
          notes?: string | null
          pipeline_id?: string
          stage_id?: string
          status?: string | null
          title?: string
          updated_at?: string | null
          user_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "deals_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      domain_events: {
        Row: {
          account_id: string
          attempts: number
          available_at: string
          causation_event_id: string | null
          chain_depth: number
          contact_id: string | null
          created_at: string
          event_type: string
          id: string
          idempotency_key: string
          last_error: string | null
          origin_run_id: string | null
          payload: Json
          processed_at: string | null
          source: string
          status: string
        }
        Insert: {
          account_id: string
          attempts?: number
          available_at?: string
          causation_event_id?: string | null
          chain_depth?: number
          contact_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          origin_run_id?: string | null
          payload?: Json
          processed_at?: string | null
          source?: string
          status?: string
        }
        Update: {
          account_id?: string
          attempts?: number
          available_at?: string
          causation_event_id?: string | null
          chain_depth?: number
          contact_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          origin_run_id?: string | null
          payload?: Json
          processed_at?: string | null
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "domain_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "domain_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "domain_events_origin_run_id_fkey"
            columns: ["origin_run_id"]
            isOneToOne: false
            referencedRelation: "automation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      member_presence: {
        Row: {
          account_id: string
          last_seen_at: string
          status: string
          user_id: string
        }
        Insert: {
          account_id: string
          last_seen_at?: string
          status?: string
          user_id: string
        }
        Update: {
          account_id?: string
          last_seen_at?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_presence_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reactions: {
        Row: {
          actor_id: string | null
          actor_type: string
          conversation_id: string
          created_at: string
          emoji: string
          id: string
          message_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_type: string
          conversation_id: string
          created_at?: string
          emoji: string
          id?: string
          message_id: string
        }
        Update: {
          actor_id?: string | null
          actor_type?: string
          conversation_id?: string
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          account_id: string
          body_text: string
          buttons: Json | null
          category: string
          created_at: string | null
          footer_text: string | null
          header_content: string | null
          header_handle: string | null
          header_media_url: string | null
          header_type: string | null
          id: string
          language: string | null
          last_submitted_at: string | null
          meta_template_id: string | null
          name: string
          quality_score: string | null
          rejection_reason: string | null
          sample_values: Json | null
          status: string | null
          submission_error: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          account_id: string
          body_text: string
          buttons?: Json | null
          category?: string
          created_at?: string | null
          footer_text?: string | null
          header_content?: string | null
          header_handle?: string | null
          header_media_url?: string | null
          header_type?: string | null
          id?: string
          language?: string | null
          last_submitted_at?: string | null
          meta_template_id?: string | null
          name: string
          quality_score?: string | null
          rejection_reason?: string | null
          sample_values?: Json | null
          status?: string | null
          submission_error?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          account_id?: string
          body_text?: string
          buttons?: Json | null
          category?: string
          created_at?: string | null
          footer_text?: string | null
          header_content?: string | null
          header_handle?: string | null
          header_media_url?: string | null
          header_type?: string | null
          id?: string
          language?: string | null
          last_submitted_at?: string | null
          meta_template_id?: string | null
          name?: string
          quality_score?: string | null
          rejection_reason?: string | null
          sample_values?: Json | null
          status?: string | null
          submission_error?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          ai_generated: boolean
          channel: string
          content_text: string | null
          content_type: string
          conversation_id: string
          created_at: string | null
          id: string
          interactive_payload: Json | null
          interactive_reply_id: string | null
          media_type: string | null
          media_url: string | null
          message_id: string | null
          reply_to_message_id: string | null
          sender_id: string | null
          sender_type: string
          status: string
          template_name: string | null
        }
        Insert: {
          ai_generated?: boolean
          channel?: string
          content_text?: string | null
          content_type?: string
          conversation_id: string
          created_at?: string | null
          id?: string
          interactive_payload?: Json | null
          interactive_reply_id?: string | null
          media_type?: string | null
          media_url?: string | null
          message_id?: string | null
          reply_to_message_id?: string | null
          sender_id?: string | null
          sender_type: string
          status?: string
          template_name?: string | null
        }
        Update: {
          ai_generated?: boolean
          channel?: string
          content_text?: string | null
          content_type?: string
          conversation_id?: string
          created_at?: string | null
          id?: string
          interactive_payload?: Json | null
          interactive_reply_id?: string | null
          media_type?: string | null
          media_url?: string | null
          message_id?: string | null
          reply_to_message_id?: string | null
          sender_id?: string | null
          sender_type?: string
          status?: string
          template_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_message_id_fkey"
            columns: ["reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          account_id: string
          actor_user_id: string | null
          body: string | null
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          id: string
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          account_id: string
          actor_user_id?: string | null
          body?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          account_id?: string
          actor_user_id?: string | null
          body?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          color: string
          created_at: string | null
          id: string
          name: string
          pipeline_id: string
          position: number
        }
        Insert: {
          color?: string
          created_at?: string | null
          id?: string
          name: string
          pipeline_id: string
          position?: number
        }
        Update: {
          color?: string
          created_at?: string | null
          id?: string
          name?: string
          pipeline_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      pipelines: {
        Row: {
          account_id: string
          created_at: string | null
          id: string
          name: string
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string | null
          id?: string
          name: string
          user_id: string
        }
        Update: {
          account_id?: string
          created_at?: string | null
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipelines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_id: string
          account_role: Database["public"]["Enums"]["account_role_enum"]
          avatar_url: string | null
          beta_features: string[]
          created_at: string | null
          email: string
          full_name: string
          id: string
          role: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          account_id: string
          account_role: Database["public"]["Enums"]["account_role_enum"]
          avatar_url?: string | null
          beta_features?: string[]
          created_at?: string | null
          email: string
          full_name: string
          id?: string
          role?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          account_id?: string
          account_role?: Database["public"]["Enums"]["account_role_enum"]
          avatar_url?: string | null
          beta_features?: string[]
          created_at?: string | null
          email?: string
          full_name?: string
          id?: string
          role?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_replies: {
        Row: {
          account_id: string
          content_text: string | null
          created_at: string
          id: string
          interactive_payload: Json | null
          kind: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          content_text?: string | null
          created_at?: string
          id?: string
          interactive_payload?: Json | null
          kind?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          content_text?: string | null
          created_at?: string
          id?: string
          interactive_payload?: Json | null
          kind?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quick_replies_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      sequence_enrollments: {
        Row: {
          account_id: string
          cancelled_at: string | null
          completed_at: string | null
          contact_id: string
          created_at: string
          current_position: number
          id: string
          next_run_at: string | null
          sequence_id: string
          status: string
          updated_at: string
        }
        Insert: {
          account_id: string
          cancelled_at?: string | null
          completed_at?: string | null
          contact_id: string
          created_at?: string
          current_position?: number
          id?: string
          next_run_at?: string | null
          sequence_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          cancelled_at?: string | null
          completed_at?: string | null
          contact_id?: string
          created_at?: string
          current_position?: number
          id?: string
          next_run_at?: string | null
          sequence_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sequence_enrollments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sequence_enrollments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sequence_enrollments_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      sequence_steps: {
        Row: {
          created_at: string
          id: string
          position: number
          sequence_id: string
          step_config: Json
          step_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          position: number
          sequence_id: string
          step_config?: Json
          step_type: string
        }
        Update: {
          created_at?: string
          id?: string
          position?: number
          sequence_id?: string
          step_config?: Json
          step_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "sequence_steps_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      sequences: {
        Row: {
          account_id: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sequences_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          account_id: string
          color: string
          created_at: string | null
          id: string
          name: string
          user_id: string
        }
        Insert: {
          account_id: string
          color?: string
          created_at?: string | null
          id?: string
          name: string
          user_id: string
        }
        Update: {
          account_id?: string
          color?: string
          created_at?: string | null
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          account_id: string
          assigned_to: string | null
          contact_id: string | null
          created_at: string
          description: string | null
          due_at: string | null
          id: string
          source_automation_id: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          assigned_to?: string | null
          contact_id?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          source_automation_id?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          assigned_to?: string | null
          contact_id?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          id?: string
          source_automation_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_source_automation_id_fkey"
            columns: ["source_automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_config: {
        Row: {
          account_id: string
          bot_id: number | null
          bot_token_encrypted: string
          bot_username: string | null
          connected_at: string | null
          created_at: string
          id: string
          status: string
          updated_at: string
          webhook_secret_encrypted: string | null
        }
        Insert: {
          account_id: string
          bot_id?: number | null
          bot_token_encrypted: string
          bot_username?: string | null
          connected_at?: string | null
          created_at?: string
          id?: string
          status?: string
          updated_at?: string
          webhook_secret_encrypted?: string | null
        }
        Update: {
          account_id?: string
          bot_id?: number | null
          bot_token_encrypted?: string
          bot_username?: string | null
          connected_at?: string | null
          created_at?: string
          id?: string
          status?: string
          updated_at?: string
          webhook_secret_encrypted?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telegram_config_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_endpoints: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          events: string[]
          failure_count: number
          id: string
          is_active: boolean
          last_delivery_at: string | null
          secret: string
          url: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          events?: string[]
          failure_count?: number
          id?: string
          is_active?: boolean
          last_delivery_at?: string | null
          secret: string
          url: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          events?: string[]
          failure_count?: number
          id?: string
          is_active?: boolean
          last_delivery_at?: string | null
          secret?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_endpoints_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_config: {
        Row: {
          access_token: string
          account_id: string
          connected_at: string | null
          created_at: string | null
          id: string
          last_registration_error: string | null
          mirror_inbound_media: boolean
          phone_number_id: string
          registered_at: string | null
          status: string
          subscribed_apps_at: string | null
          updated_at: string | null
          user_id: string
          verify_token: string | null
          waba_id: string | null
        }
        Insert: {
          access_token: string
          account_id: string
          connected_at?: string | null
          created_at?: string | null
          id?: string
          last_registration_error?: string | null
          mirror_inbound_media?: boolean
          phone_number_id: string
          registered_at?: string | null
          status?: string
          subscribed_apps_at?: string | null
          updated_at?: string | null
          user_id: string
          verify_token?: string | null
          waba_id?: string | null
        }
        Update: {
          access_token?: string
          account_id?: string
          connected_at?: string | null
          created_at?: string | null
          id?: string
          last_registration_error?: string | null
          mirror_inbound_media?: boolean
          phone_number_id?: string
          registered_at?: string | null
          status?: string
          subscribed_apps_at?: string | null
          updated_at?: string | null
          user_id?: string
          verify_token?: string | null
          waba_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_config_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _bcast_bump: {
        Args: { bid: string; col: string; delta: number }
        Returns: undefined
      }
      _bcast_cols_for_status: { Args: { s: string }; Returns: string[] }
      bump_conversation_on_inbound: {
        Args: { p_conversation_id: string; p_last_message_text: string }
        Returns: undefined
      }
      claim_ai_reply_slot: {
        Args: { conversation_id: string; max_replies: number }
        Returns: boolean
      }
      claim_automation_waits: {
        Args: { p_limit: number }
        Returns: {
          account_id: string
          claimed_at: string | null
          created_at: string
          id: string
          node_id: string
          resume_at: string
          resume_node_id: string | null
          run_id: string
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "automation_waits"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_domain_events: {
        Args: { p_limit: number }
        Returns: {
          account_id: string
          attempts: number
          available_at: string
          causation_event_id: string | null
          chain_depth: number
          contact_id: string | null
          created_at: string
          event_type: string
          id: string
          idempotency_key: string
          last_error: string | null
          origin_run_id: string | null
          payload: Json
          processed_at: string | null
          source: string
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "domain_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_due_automation_runs: {
        Args: { p_limit: number }
        Returns: {
          account_id: string
          attempt: number
          automation_id: string
          completed_at: string | null
          contact_id: string
          context: Json
          created_at: string
          current_node_id: string | null
          id: string
          last_error: string | null
          node_executions: number
          status: string
          trigger_event_id: string | null
          updated_at: string
          version_id: string
          wait_until: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "automation_runs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_broadcast_with_recipients: {
        Args: {
          p_account_id: string
          p_contact_ids: string[]
          p_name: string
          p_template_language: string
          p_template_name: string
          p_template_params: Json[]
          p_total_recipients: number
          p_user_id: string
        }
        Returns: {
          broadcast_id: string
          contact_id: string
          recipient_id: string
        }[]
      }
      filter_contacts_by_tags: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_tag_ids: string[]
        }
        Returns: {
          contact: Database["public"]["Tables"]["contacts"]["Row"]
          total_count: number
        }[]
      }
      is_account_member: {
        Args: {
          min_role?: Database["public"]["Enums"]["account_role_enum"]
          target_account_id: string
        }
        Returns: boolean
      }
      match_ai_knowledge_fts: {
        Args: { p_account_id: string; p_match_count: number; p_query: string }
        Returns: {
          content: string
          id: string
          rank: number
        }[]
      }
      match_ai_knowledge_semantic: {
        Args: {
          p_account_id: string
          p_match_count: number
          p_query_embedding: string
        }
        Returns: {
          content: string
          distance: number
          id: string
        }[]
      }
      merge_duplicate_contacts: { Args: never; Returns: number }
      merge_duplicate_conversations: { Args: never; Returns: number }
      peek_invitation: { Args: { p_token_hash: string }; Returns: Json }
      purge_automation_history: { Args: never; Returns: undefined }
      recompute_broadcast_counts: { Args: { bid: string }; Returns: undefined }
      record_webhook_failure: {
        Args: { endpoint_id: string; max_failures: number }
        Returns: undefined
      }
      redeem_invitation: { Args: { p_token_hash: string }; Returns: string }
      remove_account_member: { Args: { p_user_id: string }; Returns: string }
      set_member_role: {
        Args: {
          p_new_role: Database["public"]["Enums"]["account_role_enum"]
          p_user_id: string
        }
        Returns: undefined
      }
      touch_presence: { Args: { p_status?: string }; Returns: undefined }
      // Hand-added for migration 064 (regenerate via `npm run db:types`
      // once T1.7 lands the script to confirm).
      conversation_channel_summaries: {
        Args: { p_account_id: string }
        Returns: {
          conversation_id: string
          channels: string[] | null
          latest_channel: string | null
        }[]
      }
      transfer_account_ownership: {
        Args: { p_new_owner_user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      account_role_enum: "owner" | "admin" | "agent" | "viewer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      account_role_enum: ["owner", "admin", "agent", "viewer"],
    },
  },
} as const
