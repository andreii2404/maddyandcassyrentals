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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      agreement_acknowledgements: {
        Row: {
          acknowledged: boolean
          acknowledged_at: string | null
          acknowledgement_key: string
          agreement_version_id: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          acknowledged?: boolean
          acknowledged_at?: string | null
          acknowledgement_key: string
          agreement_version_id: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          acknowledged?: boolean
          acknowledged_at?: string | null
          acknowledgement_key?: string
          agreement_version_id?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agreement_acknowledgements_agreement_version_id_fkey"
            columns: ["agreement_version_id"]
            isOneToOne: false
            referencedRelation: "agreement_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      agreement_signatures: {
        Row: {
          agreement_version_id: string
          id: string
          ip_address: unknown
          signature_data: Json
          signature_path: string | null
          signed_at: string
          signer_name: string
          signer_role: Database["public"]["Enums"]["signer_role"]
          signer_user_id: string | null
          user_agent: string | null
        }
        Insert: {
          agreement_version_id: string
          id?: string
          ip_address?: unknown
          signature_data?: Json
          signature_path?: string | null
          signed_at?: string
          signer_name: string
          signer_role: Database["public"]["Enums"]["signer_role"]
          signer_user_id?: string | null
          user_agent?: string | null
        }
        Update: {
          agreement_version_id?: string
          id?: string
          ip_address?: unknown
          signature_data?: Json
          signature_path?: string | null
          signed_at?: string
          signer_name?: string
          signer_role?: Database["public"]["Enums"]["signer_role"]
          signer_user_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agreement_signatures_agreement_version_id_fkey"
            columns: ["agreement_version_id"]
            isOneToOne: false
            referencedRelation: "agreement_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      agreement_templates: {
        Row: {
          content: Json
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          template_code: string
          title: string
          version_number: number
        }
        Insert: {
          content: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          template_code: string
          title: string
          version_number: number
        }
        Update: {
          content?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          template_code?: string
          title?: string
          version_number?: number
        }
        Relationships: []
      }
      agreement_versions: {
        Row: {
          agreement_id: string
          agreement_snapshot: Json
          completed_at: string | null
          created_at: string
          created_by: string | null
          final_document_path: string | null
          generated_at: string | null
          generated_document_path: string | null
          id: string
          status: Database["public"]["Enums"]["agreement_status"]
          superseded_at: string | null
          version_number: number
        }
        Insert: {
          agreement_id: string
          agreement_snapshot: Json
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          final_document_path?: string | null
          generated_at?: string | null
          generated_document_path?: string | null
          id?: string
          status?: Database["public"]["Enums"]["agreement_status"]
          superseded_at?: string | null
          version_number: number
        }
        Update: {
          agreement_id?: string
          agreement_snapshot?: Json
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          final_document_path?: string | null
          generated_at?: string | null
          generated_document_path?: string | null
          id?: string
          status?: Database["public"]["Enums"]["agreement_status"]
          superseded_at?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "agreement_versions_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "booking_agreements"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_type: string
          actor_user_id: string | null
          booking_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: unknown
          metadata: Json
          new_values: Json | null
          previous_values: Json | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_type?: string
          actor_user_id?: string | null
          booking_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: unknown
          metadata?: Json
          new_values?: Json | null
          previous_values?: Json | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_type?: string
          actor_user_id?: string | null
          booking_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: unknown
          metadata?: Json
          new_values?: Json | null
          previous_values?: Json | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_totals"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "audit_logs_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_agreements: {
        Row: {
          booking_id: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          rejected_at: string | null
          status: Database["public"]["Enums"]["agreement_status"]
          template_id: string | null
          updated_at: string
        }
        Insert: {
          booking_id: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          rejected_at?: string | null
          status?: Database["public"]["Enums"]["agreement_status"]
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          booking_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          rejected_at?: string | null
          status?: Database["public"]["Enums"]["agreement_status"]
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_agreements_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "booking_totals"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "booking_agreements_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_agreements_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "agreement_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_emergency_contacts: {
        Row: {
          address: string | null
          booking_id: string
          created_at: string
          full_name: string
          phone_number: string
          relationship: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          booking_id: string
          created_at?: string
          full_name: string
          phone_number: string
          relationship: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          booking_id?: string
          created_at?: string
          full_name?: string
          phone_number?: string
          relationship?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_emergency_contacts_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "booking_totals"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "booking_emergency_contacts_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_fulfillments: {
        Row: {
          address_line_1: string | null
          address_line_2: string | null
          barangay: string | null
          booking_id: string
          city_municipality: string | null
          completed_at: string | null
          contact_number: string | null
          country_code: string
          created_at: string
          delivery_fee_snapshot: number
          pickup_convenience_fee_snapshot: number
          delivery_notes: string | null
          method: Database["public"]["Enums"]["fulfillment_method"]
          postal_code: string | null
          province: string | null
          recipient_name: string | null
          scheduled_at: string | null
          updated_at: string
        }
        Insert: {
          address_line_1?: string | null
          address_line_2?: string | null
          barangay?: string | null
          booking_id: string
          city_municipality?: string | null
          completed_at?: string | null
          contact_number?: string | null
          country_code?: string
          created_at?: string
          delivery_fee_snapshot?: number
          pickup_convenience_fee_snapshot?: number
          delivery_notes?: string | null
          method: Database["public"]["Enums"]["fulfillment_method"]
          postal_code?: string | null
          province?: string | null
          recipient_name?: string | null
          scheduled_at?: string | null
          updated_at?: string
        }
        Update: {
          address_line_1?: string | null
          address_line_2?: string | null
          barangay?: string | null
          booking_id?: string
          city_municipality?: string | null
          completed_at?: string | null
          contact_number?: string | null
          country_code?: string
          created_at?: string
          delivery_fee_snapshot?: number
          pickup_convenience_fee_snapshot?: number
          delivery_notes?: string | null
          method?: Database["public"]["Enums"]["fulfillment_method"]
          postal_code?: string | null
          province?: string | null
          recipient_name?: string | null
          scheduled_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_fulfillments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "booking_totals"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "booking_fulfillments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_items: {
        Row: {
          booking_id: string
          created_at: string
          daily_rate_snapshot: number
          deposit_per_unit_snapshot: number
          id: string
          product_id: string
          product_name_snapshot: string
          quantity: number
          updated_at: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          daily_rate_snapshot: number
          deposit_per_unit_snapshot?: number
          id?: string
          product_id: string
          product_name_snapshot: string
          quantity?: number
          updated_at?: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          daily_rate_snapshot?: number
          deposit_per_unit_snapshot?: number
          id?: string
          product_id?: string
          product_name_snapshot?: string
          quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_items_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_totals"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "booking_items_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_payment_submissions: {
        Row: {
          booking_id: string
          completed_at: string | null
          created_at: string
          currency_code: string
          declared_amount: number
          external_reference: string | null
          id: string
          idempotency_key: string | null
          payment_method: string | null
          paymongo_checkout_session_id: string | null
          paymongo_payment_id: string | null
          proof_document_id: string | null
          provider_metadata: Json
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          stage: Database["public"]["Enums"]["payment_stage"]
          status: Database["public"]["Enums"]["payment_submission_status"]
          submitted_at: string
          updated_at: string
        }
        Insert: {
          booking_id: string
          completed_at?: string | null
          created_at?: string
          currency_code?: string
          declared_amount: number
          external_reference?: string | null
          id?: string
          idempotency_key?: string | null
          payment_method?: string | null
          paymongo_checkout_session_id?: string | null
          paymongo_payment_id?: string | null
          proof_document_id?: string | null
          provider_metadata?: Json
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          stage: Database["public"]["Enums"]["payment_stage"]
          status?: Database["public"]["Enums"]["payment_submission_status"]
          submitted_at?: string
          updated_at?: string
        }
        Update: {
          booking_id?: string
          completed_at?: string | null
          created_at?: string
          currency_code?: string
          declared_amount?: number
          external_reference?: string | null
          id?: string
          idempotency_key?: string | null
          payment_method?: string | null
          paymongo_checkout_session_id?: string | null
          paymongo_payment_id?: string | null
          proof_document_id?: string | null
          provider_metadata?: Json
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          stage?: Database["public"]["Enums"]["payment_stage"]
          status?: Database["public"]["Enums"]["payment_submission_status"]
          submitted_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_payment_submissions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_totals"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "booking_payment_submissions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_payment_submissions_proof_document_id_fkey"
            columns: ["proof_document_id"]
            isOneToOne: false
            referencedRelation: "customer_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_receipts: {
        Row: {
          amount: number
          booking_id: string
          created_at: string
          document_path: string
          id: string
          issued_at: string
          issued_by: string | null
          payment_submission_id: string | null
          receipt_number: string
        }
        Insert: {
          amount: number
          booking_id: string
          created_at?: string
          document_path: string
          id?: string
          issued_at?: string
          issued_by?: string | null
          payment_submission_id?: string | null
          receipt_number: string
        }
        Update: {
          amount?: number
          booking_id?: string
          created_at?: string
          document_path?: string
          id?: string
          issued_at?: string
          issued_by?: string | null
          payment_submission_id?: string | null
          receipt_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_receipts_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_totals"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "booking_receipts_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_receipts_payment_submission_id_fkey"
            columns: ["payment_submission_id"]
            isOneToOne: false
            referencedRelation: "booking_payment_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_requirement_submissions: {
        Row: {
          attempt_number: number
          booking_requirement_id: string
          customer_document_id: string
          id: string
          review_notes: string | null
          review_status: Database["public"]["Enums"]["review_decision"]
          reviewed_at: string | null
          reviewed_by: string | null
          submitted_at: string
          updated_at: string
        }
        Insert: {
          attempt_number?: number
          booking_requirement_id: string
          customer_document_id: string
          id?: string
          review_notes?: string | null
          review_status?: Database["public"]["Enums"]["review_decision"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          submitted_at?: string
          updated_at?: string
        }
        Update: {
          attempt_number?: number
          booking_requirement_id?: string
          customer_document_id?: string
          id?: string
          review_notes?: string | null
          review_status?: Database["public"]["Enums"]["review_decision"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          submitted_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_requirement_submissions_booking_requirement_id_fkey"
            columns: ["booking_requirement_id"]
            isOneToOne: false
            referencedRelation: "booking_requirements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_requirement_submissions_customer_document_id_fkey"
            columns: ["customer_document_id"]
            isOneToOne: false
            referencedRelation: "customer_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_requirements: {
        Row: {
          booking_id: string
          created_at: string
          document_type_snapshot: string
          id: string
          is_required: boolean
          requirement_definition_id: string | null
          requirement_key_snapshot: string
          requirement_name_snapshot: string
          status: Database["public"]["Enums"]["requirement_status"]
          updated_at: string
          waived_by: string | null
          waiver_reason: string | null
        }
        Insert: {
          booking_id: string
          created_at?: string
          document_type_snapshot: string
          id?: string
          is_required?: boolean
          requirement_definition_id?: string | null
          requirement_key_snapshot: string
          requirement_name_snapshot: string
          status?: Database["public"]["Enums"]["requirement_status"]
          updated_at?: string
          waived_by?: string | null
          waiver_reason?: string | null
        }
        Update: {
          booking_id?: string
          created_at?: string
          document_type_snapshot?: string
          id?: string
          is_required?: boolean
          requirement_definition_id?: string | null
          requirement_key_snapshot?: string
          requirement_name_snapshot?: string
          status?: Database["public"]["Enums"]["requirement_status"]
          updated_at?: string
          waived_by?: string | null
          waiver_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_requirements_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_totals"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "booking_requirements_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_requirements_requirement_definition_id_fkey"
            columns: ["requirement_definition_id"]
            isOneToOne: false
            referencedRelation: "requirement_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_status_history: {
        Row: {
          booking_id: string
          changed_by: string | null
          created_at: string
          from_status: Database["public"]["Enums"]["booking_status"] | null
          id: string
          note: string | null
          to_status: Database["public"]["Enums"]["booking_status"]
        }
        Insert: {
          booking_id: string
          changed_by?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["booking_status"] | null
          id?: string
          note?: string | null
          to_status: Database["public"]["Enums"]["booking_status"]
        }
        Update: {
          booking_id?: string
          changed_by?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["booking_status"] | null
          id?: string
          note?: string | null
          to_status?: Database["public"]["Enums"]["booking_status"]
        }
        Relationships: [
          {
            foreignKeyName: "booking_status_history_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_totals"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "booking_status_history_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          admin_notes: string | null
          approved_at: string | null
          birth_date_snapshot: string | null
          birthday_discount_amount: number
          birthday_discount_status: string
          booking_reference: string
          cancelled_at: string | null
          confirmed_at: string | null
          created_at: string
          currency_code: string
          customer_id: string
          customer_notes: string | null
          id: string
          loyalty_completed_rentals_snapshot: number
          loyalty_discount_amount: number
          loyalty_discount_status: string
          next_available_at: string
          pickup_at: string
          ready_for_release_at: string | null
          rejected_at: string | null
          released_at: string | null
          rental_period: unknown
          return_at: string
          returned_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          approved_at?: string | null
          birth_date_snapshot?: string | null
          birthday_discount_amount?: number
          birthday_discount_status?: string
          booking_reference?: string
          cancelled_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          currency_code?: string
          customer_id: string
          customer_notes?: string | null
          id?: string
          loyalty_completed_rentals_snapshot?: number
          loyalty_discount_amount?: number
          loyalty_discount_status?: string
          next_available_at: string
          pickup_at: string
          ready_for_release_at?: string | null
          rejected_at?: string | null
          released_at?: string | null
          rental_period: unknown
          return_at: string
          returned_at?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          approved_at?: string | null
          birth_date_snapshot?: string | null
          birthday_discount_amount?: number
          birthday_discount_status?: string
          booking_reference?: string
          cancelled_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          currency_code?: string
          customer_id?: string
          customer_notes?: string | null
          id?: string
          loyalty_completed_rentals_snapshot?: number
          loyalty_discount_amount?: number
          loyalty_discount_status?: string
          next_available_at?: string
          pickup_at?: string
          ready_for_release_at?: string | null
          rejected_at?: string | null
          released_at?: string | null
          rental_period?: unknown
          return_at?: string
          returned_at?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
        }
        Relationships: []
      }
      brands: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      customer_documents: {
        Row: {
          created_at: string
          document_type: string
          expires_at: string | null
          file_size_bytes: number | null
          id: string
          issued_at: string | null
          mime_type: string | null
          original_filename: string | null
          owner_user_id: string
          status: Database["public"]["Enums"]["document_status"]
          storage_bucket: string
          storage_path: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          document_type: string
          expires_at?: string | null
          file_size_bytes?: number | null
          id?: string
          issued_at?: string | null
          mime_type?: string | null
          original_filename?: string | null
          owner_user_id: string
          status?: Database["public"]["Enums"]["document_status"]
          storage_bucket: string
          storage_path: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_type?: string
          expires_at?: string | null
          file_size_bytes?: number | null
          id?: string
          issued_at?: string | null
          mime_type?: string | null
          original_filename?: string | null
          owner_user_id?: string
          status?: Database["public"]["Enums"]["document_status"]
          storage_bucket?: string
          storage_path?: string
          updated_at?: string
        }
        Relationships: []
      }
      document_review_events: {
        Row: {
          created_at: string
          from_status: Database["public"]["Enums"]["review_decision"] | null
          id: string
          notes: string | null
          reviewed_by: string | null
          submission_id: string
          to_status: Database["public"]["Enums"]["review_decision"]
        }
        Insert: {
          created_at?: string
          from_status?: Database["public"]["Enums"]["review_decision"] | null
          id?: string
          notes?: string | null
          reviewed_by?: string | null
          submission_id: string
          to_status: Database["public"]["Enums"]["review_decision"]
        }
        Update: {
          created_at?: string
          from_status?: Database["public"]["Enums"]["review_decision"] | null
          id?: string
          notes?: string | null
          reviewed_by?: string | null
          submission_id?: string
          to_status?: Database["public"]["Enums"]["review_decision"]
        }
        Relationships: [
          {
            foreignKeyName: "document_review_events_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "booking_requirement_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_units: {
        Row: {
          acquired_at: string | null
          condition_notes: string | null
          created_at: string
          id: string
          lifecycle_status: Database["public"]["Enums"]["unit_lifecycle_status"]
          product_id: string
          retired_at: string | null
          serial_number: string | null
          unit_code: string
          updated_at: string
        }
        Insert: {
          acquired_at?: string | null
          condition_notes?: string | null
          created_at?: string
          id?: string
          lifecycle_status?: Database["public"]["Enums"]["unit_lifecycle_status"]
          product_id: string
          retired_at?: string | null
          serial_number?: string | null
          unit_code: string
          updated_at?: string
        }
        Update: {
          acquired_at?: string | null
          condition_notes?: string | null
          created_at?: string
          id?: string
          lifecycle_status?: Database["public"]["Enums"]["unit_lifecycle_status"]
          product_id?: string
          retired_at?: string | null
          serial_number?: string | null
          unit_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_units_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          action_url: string | null
          booking_id: string | null
          created_at: string
          expires_at: string | null
          id: string
          is_read: boolean
          message: string
          notification_type: string
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          action_url?: string | null
          booking_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          is_read?: boolean
          message: string
          notification_type: string
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          action_url?: string | null
          booking_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          is_read?: boolean
          message?: string
          notification_type?: string
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_totals"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "notifications_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      paymongo_webhook_events: {
        Row: {
          error_message: string | null
          event_type: string
          id: string
          payload: Json
          payment_record_id: string | null
          processed_at: string | null
          processing_status: string
          provider_event_id: string
          received_at: string
          signature_valid: boolean
        }
        Insert: {
          error_message?: string | null
          event_type: string
          id?: string
          payload: Json
          payment_record_id?: string | null
          processed_at?: string | null
          processing_status?: string
          provider_event_id: string
          received_at?: string
          signature_valid?: boolean
        }
        Update: {
          error_message?: string | null
          event_type?: string
          id?: string
          payload?: Json
          payment_record_id?: string | null
          processed_at?: string | null
          processing_status?: string
          provider_event_id?: string
          received_at?: string
          signature_valid?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "paymongo_webhook_events_payment_record_id_fkey"
            columns: ["payment_record_id"]
            isOneToOne: false
            referencedRelation: "booking_payment_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      product_images: {
        Row: {
          alt_text: string | null
          created_at: string
          id: string
          is_primary: boolean
          product_id: string
          sort_order: number
          storage_bucket: string
          storage_path: string
        }
        Insert: {
          alt_text?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          product_id: string
          sort_order?: number
          storage_bucket?: string
          storage_path: string
        }
        Update: {
          alt_text?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          product_id?: string
          sort_order?: number
          storage_bucket?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_requirements: {
        Row: {
          created_at: string
          is_required: boolean
          product_id: string
          requirement_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          is_required?: boolean
          product_id: string
          requirement_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          is_required?: boolean
          product_id?: string
          requirement_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_requirements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_requirements_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "requirement_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          brand_id: string | null
          category_id: string
          created_at: string
          created_by: string | null
          daily_rate: number
          description: string | null
          id: string
          is_featured: boolean
          name: string
          refundable_deposit: number
          short_description: string | null
          slug: string
          specifications: Json
          status: Database["public"]["Enums"]["product_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          brand_id?: string | null
          category_id: string
          created_at?: string
          created_by?: string | null
          daily_rate: number
          description?: string | null
          id?: string
          is_featured?: boolean
          name: string
          refundable_deposit?: number
          short_description?: string | null
          slug: string
          specifications?: Json
          status?: Database["public"]["Enums"]["product_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          brand_id?: string | null
          category_id?: string
          created_at?: string
          created_by?: string | null
          daily_rate?: number
          description?: string | null
          id?: string
          is_featured?: boolean
          name?: string
          refundable_deposit?: number
          short_description?: string | null
          slug?: string
          specifications?: Json
          status?: Database["public"]["Enums"]["product_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_addresses: {
        Row: {
          address_line_1: string
          address_line_2: string | null
          barangay: string | null
          city_municipality: string
          contact_number: string | null
          country_code: string
          created_at: string
          delivery_notes: string | null
          id: string
          is_default: boolean
          label: string | null
          postal_code: string | null
          province: string
          recipient_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address_line_1: string
          address_line_2?: string | null
          barangay?: string | null
          city_municipality: string
          contact_number?: string | null
          country_code?: string
          created_at?: string
          delivery_notes?: string | null
          id?: string
          is_default?: boolean
          label?: string | null
          postal_code?: string | null
          province: string
          recipient_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address_line_1?: string
          address_line_2?: string | null
          barangay?: string | null
          city_municipality?: string
          contact_number?: string | null
          country_code?: string
          created_at?: string
          delivery_notes?: string | null
          id?: string
          is_default?: boolean
          label?: string | null
          postal_code?: string | null
          province?: string
          recipient_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          account_status: Database["public"]["Enums"]["account_status"]
          birth_date: string | null
          birth_date_verified_at: string | null
          birth_date_verified_by: string | null
          contact_email: string | null
          created_at: string
          display_name: string
          facebook_url: string | null
          first_name: string | null
          full_address: string | null
          id: string
          instagram_url: string | null
          last_name: string | null
          phone_number: string | null
          photo_path: string | null
          updated_at: string
        }
        Insert: {
          account_status?: Database["public"]["Enums"]["account_status"]
          birth_date?: string | null
          birth_date_verified_at?: string | null
          birth_date_verified_by?: string | null
          contact_email?: string | null
          created_at?: string
          display_name: string
          facebook_url?: string | null
          first_name?: string | null
          full_address?: string | null
          id: string
          instagram_url?: string | null
          last_name?: string | null
          phone_number?: string | null
          photo_path?: string | null
          updated_at?: string
        }
        Update: {
          account_status?: Database["public"]["Enums"]["account_status"]
          birth_date?: string | null
          birth_date_verified_at?: string | null
          birth_date_verified_by?: string | null
          contact_email?: string | null
          created_at?: string
          display_name?: string
          facebook_url?: string | null
          first_name?: string | null
          full_address?: string | null
          id?: string
          instagram_url?: string | null
          last_name?: string | null
          phone_number?: string | null
          photo_path?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth_key: string
          created_at: string
          endpoint: string
          id: string
          last_seen_at: string
          p256dh_key: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth_key: string
          created_at?: string
          endpoint: string
          id?: string
          last_seen_at?: string
          p256dh_key: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth_key?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_seen_at?: string
          p256dh_key?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      requirement_definitions: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          document_type: string
          id: string
          is_active: boolean
          name: string
          requirement_key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          document_type: string
          id?: string
          is_active?: boolean
          name: string
          requirement_key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          document_type?: string
          id?: string
          is_active?: boolean
          name?: string
          requirement_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          booking_item_id: string
          comment: string | null
          created_at: string
          id: string
          moderated_at: string | null
          moderated_by: string | null
          rating: number
          status: Database["public"]["Enums"]["review_decision"]
          updated_at: string
        }
        Insert: {
          booking_item_id: string
          comment?: string | null
          created_at?: string
          id?: string
          moderated_at?: string | null
          moderated_by?: string | null
          rating: number
          status?: Database["public"]["Enums"]["review_decision"]
          updated_at?: string
        }
        Update: {
          booking_item_id?: string
          comment?: string | null
          created_at?: string
          id?: string
          moderated_at?: string | null
          moderated_by?: string | null
          rating?: number
          status?: Database["public"]["Enums"]["review_decision"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_booking_item_id_fkey"
            columns: ["booking_item_id"]
            isOneToOne: true
            referencedRelation: "booking_items"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_reservations: {
        Row: {
          booking_item_id: string | null
          created_at: string
          created_by: string | null
          id: string
          internal_note: string | null
          inventory_unit_id: string
          kind: Database["public"]["Enums"]["unit_reservation_kind"]
          reserved_period: unknown
          reserved_window: unknown
          status: Database["public"]["Enums"]["unit_reservation_status"]
          updated_at: string
        }
        Insert: {
          booking_item_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          internal_note?: string | null
          inventory_unit_id: string
          kind: Database["public"]["Enums"]["unit_reservation_kind"]
          reserved_period: unknown
          reserved_window: unknown
          status?: Database["public"]["Enums"]["unit_reservation_status"]
          updated_at?: string
        }
        Update: {
          booking_item_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          internal_note?: string | null
          inventory_unit_id?: string
          kind?: Database["public"]["Enums"]["unit_reservation_kind"]
          reserved_period?: unknown
          reserved_window?: unknown
          status?: Database["public"]["Enums"]["unit_reservation_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "unit_reservations_booking_item_id_fkey"
            columns: ["booking_item_id"]
            isOneToOne: false
            referencedRelation: "booking_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unit_reservations_inventory_unit_id_fkey"
            columns: ["inventory_unit_id"]
            isOneToOne: false
            referencedRelation: "inventory_units"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          created_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      booking_totals: {
        Row: {
          booking_id: string | null
          delivery_fee: number | null
          pickup_convenience_fee: number | null
          deposit_total: number | null
          rental_days: number | null
          rental_subtotal: number | null
          special_discount_total: number | null
          total_amount: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_set_booking_status: {
        Args: { p_booking_id: string; p_new_status: string; p_note?: string }
        Returns: {
          admin_notes: string | null
          approved_at: string | null
          booking_reference: string
          cancelled_at: string | null
          confirmed_at: string | null
          created_at: string
          currency_code: string
          customer_id: string
          customer_notes: string | null
          id: string
          ready_for_release_at: string | null
          rejected_at: string | null
          released_at: string | null
          rental_period: unknown
          returned_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_own_booking: {
        Args: { p_booking_id: string; p_note?: string }
        Returns: {
          admin_notes: string | null
          approved_at: string | null
          booking_reference: string
          cancelled_at: string | null
          confirmed_at: string | null
          created_at: string
          currency_code: string
          customer_id: string
          customer_notes: string | null
          id: string
          ready_for_release_at: string | null
          rejected_at: string | null
          released_at: string | null
          rental_period: unknown
          returned_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_own_booking_details: {
        Args: {
          p_booking_id: string
          p_city_municipality?: string
          p_customer_notes?: string
          p_fulfillment_method: string
          p_location?: string
          p_province?: string
        }
        Returns: Database["public"]["Tables"]["bookings"]["Row"]
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      confirm_booking: {
        Args: { p_booking_id: string; p_note?: string }
        Returns: {
          admin_notes: string | null
          approved_at: string | null
          booking_reference: string
          cancelled_at: string | null
          confirmed_at: string | null
          created_at: string
          currency_code: string
          customer_id: string
          customer_notes: string | null
          id: string
          ready_for_release_at: string | null
          rejected_at: string | null
          released_at: string | null
          rental_period: unknown
          returned_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_booking: {
        Args: {
          p_city_municipality?: string
          p_customer_notes: string
          p_customer_snapshot: Json
          p_delivery_fee: number
          p_discount_amount: number
          p_emergency_contact?: Json
          p_fulfillment_method: string
            p_location: string
            p_quantity?: number
            p_product_id: string
          p_product_snapshot: Json
          p_province?: string
          p_rental_end_date: string
          p_rental_start_date: string
        }
        Returns: {
          admin_notes: string | null
          approved_at: string | null
          booking_reference: string
          cancelled_at: string | null
          confirmed_at: string | null
          created_at: string
          currency_code: string
          customer_id: string
          customer_notes: string | null
          id: string
          ready_for_release_at: string | null
          rejected_at: string | null
          released_at: string | null
          rental_period: unknown
          returned_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_time_based_booking: {
        Args: {
          p_city_municipality?: string
          p_customer_notes: string
          p_customer_snapshot: Json
          p_delivery_fee: number
          p_discount_amount: number
          p_emergency_contact?: Json
          p_fulfillment_method: string
          p_location: string
          p_pickup_at: string
          p_product_id: string
          p_product_snapshot: Json
          p_province?: string
          p_quantity?: number
        }
        Returns: Database["public"]["Tables"]["bookings"]["Row"]
      }
      get_product_availability: {
        Args: { p_end_date: string; p_product_id: string; p_start_date: string }
        Returns: {
          available_units: number
          product_id: string
          total_units: number
          unavailable_units: number
        }[]
      }
      get_product_availability_calendar: {
        Args: { p_end_date: string; p_product_id: string; p_start_date: string }
        Returns: {
          available_units: number
          day: string
          total_units: number
        }[]
      }
      get_product_time_availability: {
        Args: { p_pickup_at: string; p_product_id: string; p_quantity?: number }
        Returns: {
          available_units: number
          next_available_at: string | null
          pickup_convenience_fee: number
          product_id: string
          total_units: number
          unavailable_units: number
        }[]
      }
      get_product_reviews: {
        Args: { p_limit?: number; p_offset?: number; p_product_id: string }
        Returns: {
          comment: string
          created_at: string
          rating: number
          review_id: string
        }[]
      }
      is_active_admin: { Args: never; Returns: boolean }
      log_audit_event: {
        Args: {
          p_action: string
          p_booking_id?: string
          p_entity_id: string
          p_entity_type: string
          p_metadata?: Json
          p_new_values?: Json
          p_previous_values?: Json
        }
        Returns: string
      }
      system_confirm_booking: {
        Args: { p_booking_id: string; p_note?: string }
        Returns: {
          admin_notes: string | null
          approved_at: string | null
          booking_reference: string
          cancelled_at: string | null
          confirmed_at: string | null
          created_at: string
          currency_code: string
          customer_id: string
          customer_notes: string | null
          id: string
          ready_for_release_at: string | null
          rejected_at: string | null
          released_at: string | null
          rental_period: unknown
          returned_at: string | null
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      account_status: "active" | "suspended"
      agreement_status:
        | "draft"
        | "awaiting_customer_signature"
        | "awaiting_business_signature"
        | "completed"
        | "rejected"
        | "superseded"
      app_role: "customer" | "admin"
      booking_status:
        | "draft"
        | "pending"
        | "approved"
        | "confirmed"
        | "ready_for_release"
        | "released"
        | "returned"
        | "cancelled"
        | "rejected"
      content_status: "draft" | "published" | "archived"
      document_status: "active" | "replaced" | "expired" | "deleted"
      fulfillment_method: "pickup" | "delivery"
      payment_stage: "down_payment" | "balance" | "other"
      payment_submission_status:
        | "submitted"
        | "under_review"
        | "verified"
        | "rejected"
        | "void"
      product_status: "draft" | "active" | "inactive" | "archived"
      requirement_status:
        | "pending_submission"
        | "pending_review"
        | "approved"
        | "rejected"
        | "waived"
      review_decision: "pending" | "approved" | "rejected"
      signer_role: "customer" | "business"
      unit_lifecycle_status: "active" | "maintenance" | "retired"
      unit_reservation_kind: "booking" | "maintenance" | "admin_block"
      unit_reservation_status:
        | "tentative"
        | "confirmed"
        | "in_use"
        | "completed"
        | "cancelled"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_status: ["active", "suspended"],
      agreement_status: [
        "draft",
        "awaiting_customer_signature",
        "awaiting_business_signature",
        "completed",
        "rejected",
        "superseded",
      ],
      app_role: ["customer", "admin"],
      booking_status: [
        "draft",
        "pending",
        "approved",
        "confirmed",
        "ready_for_release",
        "released",
        "returned",
        "cancelled",
        "rejected",
      ],
      content_status: ["draft", "published", "archived"],
      document_status: ["active", "replaced", "expired", "deleted"],
      fulfillment_method: ["pickup", "delivery"],
      payment_stage: ["down_payment", "balance", "other"],
      payment_submission_status: [
        "submitted",
        "under_review",
        "verified",
        "rejected",
        "void",
      ],
      product_status: ["draft", "active", "inactive", "archived"],
      requirement_status: [
        "pending_submission",
        "pending_review",
        "approved",
        "rejected",
        "waived",
      ],
      review_decision: ["pending", "approved", "rejected"],
      signer_role: ["customer", "business"],
      unit_lifecycle_status: ["active", "maintenance", "retired"],
      unit_reservation_kind: ["booking", "maintenance", "admin_block"],
      unit_reservation_status: [
        "tentative",
        "confirmed",
        "in_use",
        "completed",
        "cancelled",
      ],
    },
  },
} as const
