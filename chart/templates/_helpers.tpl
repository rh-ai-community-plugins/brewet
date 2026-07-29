{{/*
Target namespace for all namespaced resources.
*/}}
{{- define "brewet.namespace" -}}
{{- .Values.namespace | default .Release.Namespace }}
{{- end }}

{{/*
Expand the name of the chart.
*/}}
{{- define "brewet.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "brewet.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "brewet.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "brewet.labels" -}}
helm.sh/chart: {{ include "brewet.chart" . }}
{{ include "brewet.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "brewet.selectorLabels" -}}
app.kubernetes.io/name: {{ include "brewet.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create a BFF fully qualified name that respects the 63-char K8s limit.
Truncates the base fullname to 59 characters before appending "-bff".
*/}}
{{- define "brewet.bffFullname" -}}
{{- include "brewet.fullname" . | trunc 59 | trimSuffix "-" }}-bff
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "brewet.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "brewet.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Create the name of the BFF service account to use
*/}}
{{- define "brewet.bffServiceAccountName" -}}
{{- if .Values.bff.serviceAccount.create }}
{{- default (include "brewet.bffFullname" .) .Values.bff.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.bff.serviceAccount.name }}
{{- end }}
{{- end }}
